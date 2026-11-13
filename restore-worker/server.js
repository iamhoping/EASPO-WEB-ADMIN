'use strict'

const http = require('node:http')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { Transform } = require('node:stream')
const { pipeline } = require('node:stream/promises')
const readline = require('node:readline')

const RESTORE_CONFIRMATION = 'Are you sure? This will replace all current data with the backup data.'
const BACKUP_NAME_PATTERN = /^easp_backup_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-(?:AM|PM)(?:-\d+)?\.sql$/
const SIGNATURE_PREFIX = '-- EASPO-WEB-SQL-SIGNATURE: '
const JOB_LIFETIME_MS = 60 * 60 * 1000
const DEFAULT_MAX_SQL_BYTES = 100 * 1024 * 1024
const jobs = new Map()
const backupNameCounters = new Map()
let operationInProgress = false

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message)
    this.statusCode = statusCode
  }
}

function getConfig(env = process.env) {
  const supabaseUrl = env.SUPABASE_URL
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  const databaseUrl = env.SUPABASE_DB_URL
  const backupSigningSecret = env.BACKUP_SIGNING_SECRET
  const allowedOrigins = (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean)
  const maxSqlBytes = Number(env.RESTORE_MAX_BYTES || DEFAULT_MAX_SQL_BYTES)

  if (!supabaseUrl || !serviceRoleKey || !databaseUrl || !backupSigningSecret || !allowedOrigins.length) {
    throw new Error('Required restore worker environment variables are missing.')
  }
  if (backupSigningSecret.length < 32) {
    throw new Error('BACKUP_SIGNING_SECRET must contain at least 32 characters.')
  }
  const allowAllOrigins = allowedOrigins.includes('*')
  if (allowAllOrigins && allowedOrigins.length !== 1) {
    throw new Error('Use * alone or list exact origins in ALLOWED_ORIGINS, not both.')
  }
  if (!Number.isSafeInteger(maxSqlBytes) || maxSqlBytes < 1024) {
    throw new Error('RESTORE_MAX_BYTES must be an integer of at least 1024.')
  }

  const supabase = new URL(supabaseUrl)
  if (supabase.protocol !== 'https:') throw new Error('SUPABASE_URL must use HTTPS.')
  for (const origin of allowAllOrigins ? [] : allowedOrigins) {
    let parsedOrigin
    try {
      parsedOrigin = new URL(origin)
    } catch {
      throw new Error('ALLOWED_ORIGINS must contain exact HTTPS origins.')
    }
    if (parsedOrigin.protocol !== 'https:' || parsedOrigin.origin !== origin) {
      throw new Error('ALLOWED_ORIGINS must contain exact HTTPS origins without trailing slashes or paths.')
    }
  }
  const projectRef = supabase.hostname.split('.')[0]
  const database = parseDatabaseUrl(databaseUrl, projectRef)

  return {
    supabaseUrl: supabase.origin,
    serviceRoleKey,
    backupSigningSecret,
    database,
    allowedOrigins: new Set(allowedOrigins),
    allowAllOrigins,
    maxSqlBytes,
    timeoutMs: Number(env.RESTORE_TIMEOUT_MS) || 60 * 60 * 1000,
  }
}

function parseDatabaseUrl(value, projectRef) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('SUPABASE_DB_URL is not a valid PostgreSQL connection URL.')
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('SUPABASE_DB_URL must use a PostgreSQL protocol.')
  }

  const databaseName = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
  const username = decodeURIComponent(url.username)
  const password = decodeURIComponent(url.password)
  if (!url.hostname || !databaseName || !username || !password) {
    throw new Error('SUPABASE_DB_URL must include a host, database, username, and password.')
  }

  const directHost = `db.${projectRef}.supabase.co`
  const isDirectConnection = url.hostname.toLowerCase() === directHost
  const isProjectPooler = url.hostname.toLowerCase().endsWith('.pooler.supabase.com') &&
    username.endsWith(`.${projectRef}`)
  if (!isDirectConnection && !isProjectPooler) {
    throw new Error('SUPABASE_DB_URL must point to the same Supabase project as SUPABASE_URL.')
  }

  const sslMode = url.searchParams.get('sslmode') || 'require'
  if (!['require', 'verify-ca', 'verify-full'].includes(sslMode)) {
    throw new Error('SUPABASE_DB_URL must use SSL.')
  }

  return {
    host: url.hostname,
    port: url.port || '5432',
    database: databaseName,
    username,
    password,
    sslMode,
  }
}

function databaseEnvironment(database, appName) {
  return {
    PATH: process.env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    HOME: process.env.HOME || os.tmpdir(),
    LANG: 'C',
    PGHOST: database.host,
    PGPORT: database.port,
    PGDATABASE: database.database,
    PGUSER: database.username,
    PGPASSWORD: database.password,
    PGSSLMODE: database.sslMode,
    PGAPPNAME: appName,
  }
}

function validateBackupName(name) {
  return typeof name === 'string' && BACKUP_NAME_PATTERN.test(name)
}

async function signDumpFile(filePath, secret) {
  const handle = await fs.promises.open(filePath, 'r')
  let needsNewline = false
  try {
    const stats = await handle.stat()
    if (stats.size) {
      const lastByte = Buffer.alloc(1)
      await handle.read(lastByte, 0, 1, stats.size - 1)
      needsNewline = lastByte[0] !== 10
    }
  } finally {
    await handle.close()
  }
  if (needsNewline) await fs.promises.appendFile(filePath, '\n')

  const hmac = crypto.createHmac('sha256', secret)
  for await (const chunk of fs.createReadStream(filePath)) hmac.update(chunk)
  await fs.promises.appendFile(filePath, `${SIGNATURE_PREFIX}${hmac.digest('hex')}\n`, { mode: 0o600 })
}

async function verifyDumpSignature(filePath, secret) {
  const stats = await fs.promises.stat(filePath)
  const tailLength = Buffer.byteLength(SIGNATURE_PREFIX) + 64 + 1
  if (stats.size <= tailLength) throw new HttpError(400, 'Upload a full SQL backup created by the EASPO Render worker.')

  const tail = Buffer.alloc(tailLength)
  const handle = await fs.promises.open(filePath, 'r')
  try {
    const { bytesRead } = await handle.read(tail, 0, tail.length, stats.size - tail.length)
    if (bytesRead !== tail.length) throw new HttpError(400, 'The SQL backup is incomplete.')
  } finally {
    await handle.close()
  }

  const signatureLine = tail.toString('utf8')
  const match = new RegExp(`^${SIGNATURE_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([a-f0-9]{64})\\n$`).exec(signatureLine)
  if (!match) throw new HttpError(400, 'Upload a full SQL backup created by the EASPO Render worker.')

  const bodySize = stats.size - tailLength
  const lastBodyByte = Buffer.alloc(1)
  const bodyHandle = await fs.promises.open(filePath, 'r')
  try {
    const { bytesRead } = await bodyHandle.read(lastBodyByte, 0, 1, bodySize - 1)
    if (bytesRead !== 1 || lastBodyByte[0] !== 10) {
      throw new HttpError(400, 'The SQL backup signature is invalid.')
    }
  } finally {
    await bodyHandle.close()
  }

  const hmac = crypto.createHmac('sha256', secret)
  for await (const chunk of fs.createReadStream(filePath, { start: 0, end: bodySize - 1 })) hmac.update(chunk)
  const expected = Buffer.from(match[1], 'hex')
  const actual = hmac.digest()
  if (!crypto.timingSafeEqual(expected, actual)) {
    throw new HttpError(400, 'The SQL backup is invalid or has been modified.')
  }
}

async function validatePlainDump(filePath, signingSecret) {
  await verifyDumpSignature(filePath, signingSecret)
  const header = Buffer.alloc(2048)
  const handle = await fs.promises.open(filePath, 'r')
  let bytesRead
  try {
    ;({ bytesRead } = await handle.read(header, 0, header.length, 0))
  } finally {
    await handle.close()
  }
  if (!bytesRead || !header.subarray(0, bytesRead).includes(Buffer.from('PostgreSQL database dump'))) {
    throw new HttpError(400, 'The file is not a plain PostgreSQL database dump.')
  }

  let insideCopy = false
  let restrictToken = null
  let unrestrictToken = null
  const lines = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  })

  for await (const line of lines) {
    if (insideCopy) {
      if (line === '\\.') insideCopy = false
      continue
    }

    if (/^COPY\b.*\bFROM stdin;$/i.test(line)) {
      insideCopy = true
      continue
    }

    const trimmed = line.trimStart()
    if (!trimmed.startsWith('\\')) continue
    const restrict = /^\\restrict ([A-Za-z0-9+/=]+)$/.exec(trimmed)
    const unrestrict = /^\\unrestrict ([A-Za-z0-9+/=]+)$/.exec(trimmed)
    if (restrict && !restrictToken && !unrestrictToken) {
      restrictToken = restrict[1]
      continue
    }
    if (unrestrict && restrictToken && !unrestrictToken) {
      unrestrictToken = unrestrict[1]
      continue
    }
    throw new HttpError(400, 'The SQL file contains unsupported psql commands.')
  }

  if (insideCopy || Boolean(restrictToken) !== Boolean(unrestrictToken) ||
      (restrictToken && restrictToken !== unrestrictToken)) {
    throw new HttpError(400, 'The SQL dump is incomplete or invalid.')
  }
}

function startProgram(command, args, environment, timeoutMs, stdout = 'ignore') {
  let child
  try {
    child = spawn(command, args, {
      env: environment,
      stdio: ['ignore', stdout, 'pipe'],
      shell: false,
    })
  } catch {
    throw new Error(`${command} could not be started.`)
  }

  child.stderr.on('data', () => {})
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    child.kill('SIGTERM')
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }, 10000).unref()
  }, timeoutMs)
  timeout.unref()

  const completion = new Promise((resolve, reject) => {
    child.once('error', () => {
      clearTimeout(timeout)
      reject(new Error(`${command} could not be started.`))
    })
    child.once('close', (code, signal) => {
      clearTimeout(timeout)
      if (timedOut) {
        reject(new Error(`${command} exceeded the configured time limit.`))
      } else if (code !== 0) {
        reject(new Error(`${command} failed${signal ? ` (${signal})` : ` with exit code ${code}`}.`))
      } else {
        resolve()
      }
    })
  })
  return { child, completion }
}

function runProgram(command, args, environment, timeoutMs) {
  return startProgram(command, args, environment, timeoutMs).completion
}

async function runProgramToFile(command, args, environment, timeoutMs, filePath, maxBytes) {
  const { child, completion } = startProgram(command, args, environment, timeoutMs, 'pipe')
  let totalBytes = 0
  const limit = new Transform({
    transform(chunk, encoding, callback) {
      totalBytes += chunk.length
      if (totalBytes > maxBytes) {
        callback(new Error(`The SQL backup exceeds the ${maxBytes}-byte limit.`))
        return
      }
      callback(null, chunk)
    },
  })
  const output = pipeline(
    child.stdout,
    limit,
    fs.createWriteStream(filePath, { flags: 'wx', mode: 0o600 }),
  )
  output.catch(() => child.kill('SIGTERM'))
  try {
    await Promise.all([completion, output])
  } catch (error) {
    child.kill('SIGTERM')
    await Promise.allSettled([completion, output])
    throw error
  }
}

function makeJob(ownerId, operation, filename) {
  const id = crypto.randomUUID()
  const token = crypto.randomBytes(32).toString('base64url')
  const job = {
    id,
    ownerId,
    operation,
    filename,
    tokenHash: crypto.createHash('sha256').update(token).digest(),
    status: 'queued',
    message: operation === 'backup' ? 'Preparing full database backup.' : 'Preparing full database restore.',
    createdAt: Date.now(),
    finishedAt: null,
    directory: null,
    filePath: null,
  }
  jobs.set(id, job)
  return { job, token }
}

function removeJob(job) {
  if (job.directory) {
    fs.promises.rm(job.directory, { recursive: true, force: true }).catch(() => {
      console.error('[full-database-worker] Temporary backup cleanup failed.')
    })
  }
  jobs.delete(job.id)
}

function cleanupExpiredJobs() {
  const now = Date.now()
  for (const job of jobs.values()) {
    if (job.finishedAt && now - job.finishedAt > JOB_LIFETIME_MS) removeJob(job)
  }
}

function statusFor(job) {
  return {
    jobId: job.id,
    status: job.status,
    message: job.message,
    ...(job.status === 'completed' && job.operation === 'backup' ? { downloadReady: true } : {}),
  }
}

function claimOperation() {
  if (operationInProgress) throw new HttpError(409, 'Another full database operation is already running.')
  operationInProgress = true
}

async function authenticateWebAdmin(request, config) {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.authorization || '')
  if (!match) throw new HttpError(401, 'Sign in as an active Web Admin to continue.')

  let userResponse
  try {
    userResponse = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: config.serviceRoleKey,
        authorization: `Bearer ${match[1]}`,
      },
    })
  } catch {
    throw new HttpError(503, 'The Supabase session could not be verified. Try again.')
  }
  if (userResponse.status === 401 || userResponse.status === 403) {
    throw new HttpError(401, 'Your session is invalid or expired. Sign in again.')
  }
  if (!userResponse.ok) throw new HttpError(503, 'The Supabase session could not be verified. Try again.')

  let user
  try {
    user = await userResponse.json()
  } catch {
    throw new HttpError(503, 'The Supabase session could not be verified. Try again.')
  }
  if (typeof user.id !== 'string' || !user.id) {
    throw new HttpError(401, 'Your session is invalid or expired. Sign in again.')
  }

  const profileUrl = new URL('/rest/v1/profiles', config.supabaseUrl)
  profileUrl.searchParams.set('id', `eq.${user.id}`)
  profileUrl.searchParams.set('select', 'role,status')
  profileUrl.searchParams.set('limit', '1')
  let profileResponse
  try {
    profileResponse = await fetch(profileUrl, {
      headers: {
        apikey: config.serviceRoleKey,
        authorization: `Bearer ${config.serviceRoleKey}`,
      },
    })
  } catch {
    throw new HttpError(503, 'Administrator access could not be verified. Try again.')
  }
  if (!profileResponse.ok) throw new HttpError(503, 'Administrator access could not be verified. Try again.')

  let profiles
  try {
    profiles = await profileResponse.json()
  } catch {
    throw new HttpError(503, 'Administrator access could not be verified. Try again.')
  }
  const profile = Array.isArray(profiles) ? profiles[0] : null
  if (!profile || profile.role !== 'WEB_ADMIN' ||
      ['inactive', 'archived'].includes(String(profile.status || '').toLowerCase())) {
    throw new HttpError(403, 'Only active Web Admins can create or restore full database backups.')
  }
  return user.id
}

function authorizeJob(request, job) {
  const supplied = request.headers['x-easpo-job-token']
  if (typeof supplied !== 'string') throw new HttpError(404, 'The requested backup job was not found.')
  const suppliedHash = crypto.createHash('sha256').update(supplied).digest()
  if (suppliedHash.length !== job.tokenHash.length ||
      !crypto.timingSafeEqual(suppliedHash, job.tokenHash)) {
    throw new HttpError(404, 'The requested backup job was not found.')
  }
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify(body))
}

function sendError(response, error) {
  if (response.destroyed) return
  if (response.headersSent) {
    response.destroy()
    return
  }
  const statusCode = error instanceof HttpError ? error.statusCode : 500
  const message = error instanceof HttpError ? error.message : 'The full database operation failed.'
  sendJson(response, statusCode, { error: message })
}

function addCors(request, response, config) {
  const origin = request.headers.origin
  if (typeof origin !== 'string' ||
      (!config.allowAllOrigins && !config.allowedOrigins.has(origin))) return false
  response.setHeader('Access-Control-Allow-Origin', config.allowAllOrigins ? '*' : origin)
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  response.setHeader(
    'Access-Control-Allow-Headers',
    'Authorization, Content-Type, X-EASPO-Confirmation, X-EASPO-Backup-Filename, X-EASPO-Job-Token',
  )
  response.setHeader('Access-Control-Expose-Headers', 'Content-Disposition')
  response.setHeader('Access-Control-Max-Age', '600')
  if (!config.allowAllOrigins) response.setHeader('Vary', 'Origin')
  return true
}

function createFilename(now = new Date()) {
  const year = now.getUTCFullYear()
  const month = String(now.getUTCMonth() + 1).padStart(2, '0')
  const day = String(now.getUTCDate()).padStart(2, '0')
  const hour24 = now.getUTCHours()
  const hour = String(hour24 % 12 || 12).padStart(2, '0')
  const minute = String(now.getUTCMinutes()).padStart(2, '0')
  const meridiem = hour24 < 12 ? 'AM' : 'PM'
  const stem = `easp_backup_${year}-${month}-${day}_${hour}-${minute}-${meridiem}`
  const sequence = (backupNameCounters.get(stem) || 0) + 1
  backupNameCounters.set(stem, sequence)
  return `${stem}${sequence === 1 ? '' : `-${sequence}`}.sql`
}

async function receiveSqlUpload(request, filePath, maxBytes) {
  const contentLength = Number(request.headers['content-length'])
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new HttpError(413, `The SQL backup exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MiB upload limit.`)
  }

  let totalBytes = 0
  const limit = new Transform({
    transform(chunk, encoding, callback) {
      totalBytes += chunk.length
      if (totalBytes > maxBytes) {
        callback(new HttpError(413, `The SQL backup exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MiB upload limit.`))
        return
      }
      callback(null, chunk)
    },
  })
  await pipeline(
    request,
    limit,
    fs.createWriteStream(filePath, { flags: 'wx', mode: 0o600 }),
  )
  if (!totalBytes) throw new HttpError(400, 'Choose a non-empty SQL backup file.')
  return totalBytes
}

async function runBackupJob(job, config) {
  try {
    job.status = 'running'
    job.message = 'Creating the full PostgreSQL backup.'
    job.directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'easpo-backup-'))
    job.filePath = path.join(job.directory, job.filename)
    await runProgramToFile('pg_dump', [
      '--no-password',
      '--format=plain',
      '--clean',
      '--if-exists',
      '--no-owner',
      '--no-acl',
    ], databaseEnvironment(config.database, 'easpo-full-backup'), config.timeoutMs, job.filePath, config.maxSqlBytes)
    await signDumpFile(job.filePath, config.backupSigningSecret)
    await validatePlainDump(job.filePath, config.backupSigningSecret)
    const stats = await fs.promises.stat(job.filePath)
    if (!stats.size || stats.size > config.maxSqlBytes) {
      throw new Error('The SQL backup exceeded the configured size limit.')
    }
    job.status = 'completed'
    job.message = `Full database backup ready (${Math.ceil(stats.size / (1024 * 1024))} MiB).`
  } catch (error) {
    job.status = 'failed'
    job.message = 'Full database backup failed. Check the Render worker logs and database connection settings.'
    console.error('[full-database-backup] Operation failed:', error.message)
    if (job.directory) await fs.promises.rm(job.directory, { recursive: true, force: true }).catch(() => {
      console.error('[full-database-backup] Temporary file cleanup failed.')
    })
    job.directory = null
    job.filePath = null
  } finally {
    job.finishedAt = Date.now()
    operationInProgress = false
  }
}

async function runRestoreJob(job, config) {
  try {
    job.status = 'running'
    job.message = 'Replacing database contents from the SQL backup. Keep this page open until completion.'
    await runProgram('psql', [
      '--no-psqlrc',
      '--set=ON_ERROR_STOP=1',
      '--single-transaction',
      '--file',
      job.filePath,
    ], databaseEnvironment(config.database, 'easpo-full-restore'), config.timeoutMs)
    job.status = 'completed'
    job.message = 'Full database restore completed. Sign in again if the restored Auth data changed your session.'
  } catch (error) {
    job.status = 'failed'
    job.message = 'Full database restore failed. The SQL ran in a single transaction; inspect the target database before retrying.'
    console.error('[full-database-restore] Operation failed:', error.message)
  } finally {
    if (job.directory) await fs.promises.rm(job.directory, { recursive: true, force: true }).catch(() => {
      console.error('[full-database-restore] Temporary file cleanup failed.')
    })
    job.directory = null
    job.filePath = null
    job.finishedAt = Date.now()
    operationInProgress = false
  }
}

async function handleRequest(request, response, config) {
  cleanupExpiredJobs()
  const parsedUrl = new URL(request.url, 'http://localhost')

  if (parsedUrl.pathname === '/health' && request.method === 'GET') {
    sendJson(response, 200, { ok: true })
    return
  }

  if (!addCors(request, response, config)) {
    sendJson(response, 403, { error: 'This origin is not allowed.' })
    return
  }
  if (request.method === 'OPTIONS') {
    response.writeHead(204)
    response.end()
    return
  }

  if (request.method === 'POST' && parsedUrl.pathname === '/api/backup') {
    const ownerId = await authenticateWebAdmin(request, config)
    claimOperation()
    const filename = createFilename()
    const { job, token } = makeJob(ownerId, 'backup', filename)
    sendJson(response, 202, { ...statusFor(job), jobToken: token })
    setImmediate(() => runBackupJob(job, config))
    return
  }

  if (request.method === 'POST' && parsedUrl.pathname === '/api/restore') {
    const ownerId = await authenticateWebAdmin(request, config)
    if (request.headers['x-easpo-confirmation'] !== RESTORE_CONFIRMATION) {
      throw new HttpError(400, 'The exact full-restore confirmation is required.')
    }
    const filename = request.headers['x-easpo-backup-filename']
    if (!validateBackupName(filename)) {
      throw new HttpError(400, 'Choose a dated EASPO full SQL backup file.')
    }
    const contentType = String(request.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
    if (!['application/sql', 'application/octet-stream', 'text/plain'].includes(contentType)) {
      throw new HttpError(415, 'Upload the SQL backup as a file.')
    }

    claimOperation()
    let directory
    try {
      directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'easpo-restore-'))
      const filePath = path.join(directory, 'restore.sql')
      await receiveSqlUpload(request, filePath, config.maxSqlBytes)
      await validatePlainDump(filePath, config.backupSigningSecret)
      const { job, token } = makeJob(ownerId, 'restore', filename)
      job.directory = directory
      job.filePath = filePath
      sendJson(response, 202, { ...statusFor(job), jobToken: token })
      setImmediate(() => runRestoreJob(job, config))
    } catch (error) {
      if (directory) await fs.promises.rm(directory, { recursive: true, force: true }).catch(() => {})
      operationInProgress = false
      throw error
    }
    return
  }

  const jobMatch = /^\/api\/jobs\/([0-9a-f-]{36})(\/download)?$/.exec(parsedUrl.pathname)
  if (jobMatch && request.method === 'GET') {
    const job = jobs.get(jobMatch[1])
    if (!job) throw new HttpError(404, 'The requested backup job was not found or has expired.')
    authorizeJob(request, job)

    if (!jobMatch[2]) {
      sendJson(response, 200, statusFor(job))
      return
    }
    if (job.operation !== 'backup' || job.status !== 'completed' || !job.filePath) {
      throw new HttpError(409, 'The full database backup is not ready to download.')
    }
    const stats = await fs.promises.stat(job.filePath)
    response.writeHead(200, {
      'Content-Type': 'application/sql',
      'Content-Length': stats.size,
      'Content-Disposition': `attachment; filename="${job.filename}"`,
      'Cache-Control': 'no-store',
    })
    try {
      await pipeline(fs.createReadStream(job.filePath), response)
    } finally {
      removeJob(job)
    }
    return
  }

  throw new HttpError(404, 'The requested restore worker endpoint was not found.')
}

function createServer(config = getConfig()) {
  return http.createServer((request, response) => {
    handleRequest(request, response, config).catch(error => {
      if (!(error instanceof HttpError)) {
        console.error('[full-database-worker] Request failed:', error.message)
      }
      sendError(response, error)
    })
  })
}

if (require.main === module) {
  const config = getConfig()
  const port = Number(process.env.PORT) || 10000
  const server = createServer(config)
  server.listen(port, '0.0.0.0', () => {
    console.log(`EASPO full database worker listening on port ${port}.`)
  })
}

module.exports = {
  BACKUP_NAME_PATTERN,
  RESTORE_CONFIRMATION,
  createFilename,
  createServer,
  databaseEnvironment,
  parseDatabaseUrl,
  signDumpFile,
  validateBackupName,
  validatePlainDump,
}
