'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const {
  createFilename,
  createServer,
  databaseEnvironment,
  parseDatabaseUrl,
  signDumpFile,
  validateBackupName,
  validatePlainDump,
} = require('./server')

const backupSigningSecret = 'test-secret-with-more-than-thirty-two-characters'

test('database URL is validated against the configured Supabase project and requires SSL', () => {
  const database = parseDatabaseUrl(
    'postgresql://postgres:secret@db.abc123.supabase.co:5432/postgres?sslmode=require',
    'abc123',
  )
  assert.equal(database.host, 'db.abc123.supabase.co')
  assert.equal(database.port, '5432')
  assert.equal(database.username, 'postgres')
  assert.equal(database.sslMode, 'require')
  assert.throws(() => parseDatabaseUrl(
    'postgresql://postgres:secret@db.other.supabase.co:5432/postgres',
    'abc123',
  ), /same Supabase project/)
  assert.throws(() => parseDatabaseUrl(
    'postgresql://postgres:secret@db.abc123.supabase.co:5432/postgres?sslmode=disable',
    'abc123',
  ), /must use SSL/)
})

test('database child environment does not inherit application secrets', () => {
  const environment = databaseEnvironment({
    host: 'db.abc123.supabase.co',
    port: '5432',
    database: 'postgres',
    username: 'postgres',
    password: 'secret',
    sslMode: 'require',
  }, 'test')
  assert.equal(environment.PGPASSWORD, 'secret')
  assert.equal(environment.SUPABASE_SERVICE_ROLE_KEY, undefined)
  assert.equal(environment.SUPABASE_DB_URL, undefined)
})

test('backup names are unique-format dated SQL names', () => {
  assert.equal(validateBackupName('easp_backup_2026-11-13_09-00-AM.sql'), true)
  assert.equal(validateBackupName('easp_backup_2026-11-13_09-00-AM-2.sql'), true)
  assert.equal(validateBackupName('../easp_backup_2026-11-13_09-00-AM.sql'), false)
  assert.equal(validateBackupName('backup.sql'), false)
  const timestamp = new Date('2026-11-13T21:00:00Z')
  assert.equal(createFilename(timestamp), 'easp_backup_2026-11-13_09-00-PM.sql')
  assert.equal(createFilename(timestamp), 'easp_backup_2026-11-13_09-00-PM-2.sql')
})

test('plain dump validation accepts pg_dump data and rejects psql shell commands', async () => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'easpo-worker-test-'))
  const sqlPath = path.join(directory, 'backup.sql')
  try {
    await fs.promises.writeFile(sqlPath, [
      '-- PostgreSQL database dump',
      'CREATE TABLE public.example (id integer);',
      'COPY public.example (id) FROM stdin;',
      '1',
      '\\.',
      '',
    ].join('\n'))
    await signDumpFile(sqlPath, backupSigningSecret)
    await validatePlainDump(sqlPath, backupSigningSecret)

    const signedContents = await fs.promises.readFile(sqlPath, 'utf8')
    await fs.promises.writeFile(sqlPath, signedContents.replace('id integer', 'id text'))
    await assert.rejects(validatePlainDump(sqlPath, backupSigningSecret), /invalid or has been modified/)

    await fs.promises.writeFile(sqlPath, [
      '-- PostgreSQL database dump',
      '\\! echo unsafe',
      '',
    ].join('\n'))
    await signDumpFile(sqlPath, backupSigningSecret)
    await assert.rejects(validatePlainDump(sqlPath, backupSigningSecret), /unsupported psql commands/)
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true })
  }
})

test('restore routes require an allowed origin, Web Admin session, and exact confirmation', async () => {
  const nativeFetch = global.fetch
  const config = {
    supabaseUrl: 'https://abc123.supabase.co',
    serviceRoleKey: 'server-only-key',
    database: {
      host: 'db.abc123.supabase.co',
      port: '5432',
      database: 'postgres',
      username: 'postgres',
      password: 'secret',
      sslMode: 'require',
    },
    allowedOrigins: new Set(['https://easpo.example']),
    maxSqlBytes: 1024 * 1024,
    timeoutMs: 1000,
  }
  const server = createServer(config)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const baseUrl = `http://127.0.0.1:${address.port}`

  try {
    const wrongOrigin = await nativeFetch(`${baseUrl}/api/backup`, {
      method: 'POST',
      headers: { Origin: 'https://not-easpo.example' },
    })
    assert.equal(wrongOrigin.status, 403)

    const missingSession = await nativeFetch(`${baseUrl}/api/backup`, {
      method: 'POST',
      headers: { Origin: 'https://easpo.example' },
    })
    assert.equal(missingSession.status, 401)

    global.fetch = async (url) => {
      if (String(url).endsWith('/auth/v1/user')) {
        return new Response(JSON.stringify({ id: 'admin-id' }), { status: 200 })
      }
      return new Response(JSON.stringify([{ role: 'WEB_ADMIN', status: 'active' }]), { status: 200 })
    }

    const missingConfirmation = await nativeFetch(`${baseUrl}/api/restore`, {
      method: 'POST',
      headers: {
        Origin: 'https://easpo.example',
        Authorization: 'Bearer valid-session',
        'Content-Type': 'application/sql',
        'X-EASPO-Backup-Filename': 'easp_backup_2026-11-13_09-00-AM.sql',
      },
    })
    assert.equal(missingConfirmation.status, 400)
    assert.match((await missingConfirmation.json()).error, /exact full-restore confirmation/)
  } finally {
    global.fetch = nativeFetch
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})

test('wildcard CORS still requires a valid Web Admin session', async () => {
  const config = {
    supabaseUrl: 'https://abc123.supabase.co',
    serviceRoleKey: 'server-only-key',
    database: {
      host: 'db.abc123.supabase.co',
      port: '5432',
      database: 'postgres',
      username: 'postgres',
      password: 'secret',
      sslMode: 'require',
    },
    allowedOrigins: new Set(['*']),
    allowAllOrigins: true,
    maxSqlBytes: 1024 * 1024,
    timeoutMs: 1000,
  }
  const server = createServer(config)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  try {
    const preflight = await fetch(`http://127.0.0.1:${address.port}/api/restore`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://unrelated.example',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type,x-easpo-confirmation',
      },
    })
    assert.equal(preflight.status, 204)
    assert.equal(preflight.headers.get('access-control-allow-origin'), '*')

    const response = await fetch(`http://127.0.0.1:${address.port}/api/backup`, {
      method: 'POST',
      headers: { Origin: 'https://unrelated.example' },
    })
    assert.equal(response.status, 401)
    assert.equal(response.headers.get('access-control-allow-origin'), '*')

    const withoutOrigin = await fetch(`http://127.0.0.1:${address.port}/api/backup`, {
      method: 'POST',
    })
    assert.equal(withoutOrigin.status, 401)
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})
