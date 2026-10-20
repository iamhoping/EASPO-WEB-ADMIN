import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient, type SupabaseClient, type User } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const BUCKET = 'easpo-backups'
const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_RECORDS = 50000
const PAGE_SIZE = 1000
const FORMAT = 'easpo-selective-backup'
const MAGIC = new TextEncoder().encode('EASPOBK1')

const DATASETS = {
  students: { table: 'profiles', role: 'STUDENT', orderColumn: 'id' },
  teachers: { table: 'profiles', role: 'TEACHER', orderColumn: 'id' },
  parents: { table: 'profiles', role: 'PARENT', orderColumn: 'id' },
  sections: { table: 'sections', dateColumn: 'created_at', orderColumn: 'id' },
  subjects: { table: 'subjects', dateColumn: 'created_at', orderColumn: 'id' },
  schedules: { table: 'schedules', dateColumn: 'created_at', orderColumn: 'id' },
  grades: { table: 'grades', dateColumn: 'created_at', orderColumn: 'id' },
  attendance: { table: 'attendance', dateColumn: 'attendance_date', orderColumn: 'attendance_date', secondaryOrderColumn: 'student_id' },
  system_settings: { table: 'system_settings', dateColumn: 'updated_at', orderColumn: 'key' },
} as const

type DatasetName = keyof typeof DATASETS
type BackupPackage = {
  format: string
  version: number
  createdAt: string
  filters: { dateFrom: string | null; dateTo: string | null }
  tables: DatasetName[]
  records: Partial<Record<DatasetName, Record<string, unknown>[]>>
}

type Context = { admin: SupabaseClient; user: User }

function response(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function base64Bytes(value: string): Uint8Array {
  const decoded = atob(value)
  return Uint8Array.from(decoded, character => character.charCodeAt(0))
}

async function encryptionKey() {
  const encoded = Deno.env.get('EASPO_BACKUP_ENCRYPTION_KEY')
  if (!encoded) throw new Error('EASPO_BACKUP_ENCRYPTION_KEY is not configured.')
  const bytes = base64Bytes(encoded)
  if (bytes.length !== 32) throw new Error('EASPO_BACKUP_ENCRYPTION_KEY must be a base64-encoded 32-byte key.')
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

async function encryptBackup(plain: Uint8Array) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(), plain))
  const encrypted = new Uint8Array(MAGIC.length + iv.length + cipher.length)
  encrypted.set(MAGIC)
  encrypted.set(iv, MAGIC.length)
  encrypted.set(cipher, MAGIC.length + iv.length)
  return encrypted
}

async function decryptBackup(encrypted: Uint8Array): Promise<BackupPackage> {
  if (encrypted.length <= MAGIC.length + 12 ||
      !MAGIC.every((byte, index) => encrypted[index] === byte)) {
    throw new Error('This is not a supported EASPO backup file.')
  }
  const iv = encrypted.slice(MAGIC.length, MAGIC.length + 12)
  const cipher = encrypted.slice(MAGIC.length + 12)
  let decrypted: ArrayBuffer
  try {
    decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await encryptionKey(), cipher)
  } catch {
    throw new Error('Backup decryption or integrity validation failed. Check that the original backup key is configured.')
  }
  let backup: unknown
  try {
    backup = JSON.parse(new TextDecoder().decode(decrypted))
  } catch {
    throw new Error('The decrypted backup does not contain valid JSON.')
  }
  return validateBackup(backup)
}

function isDataset(value: unknown): value is DatasetName {
  return typeof value === 'string' && Object.hasOwn(DATASETS, value)
}

function validateBackup(value: unknown): BackupPackage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The backup file has an invalid structure.')
  }
  const candidate = value as Partial<BackupPackage>
  if (candidate.format !== FORMAT || candidate.version !== 1 ||
      typeof candidate.createdAt !== 'string' || !Number.isFinite(Date.parse(candidate.createdAt)) ||
      !Array.isArray(candidate.tables) || !candidate.tables.length ||
      !candidate.records || typeof candidate.records !== 'object' || Array.isArray(candidate.records)) {
    throw new Error('The backup format or required metadata is invalid.')
  }
  if (!candidate.tables.every(isDataset) || new Set(candidate.tables).size !== candidate.tables.length) {
    throw new Error('The backup contains unsupported or duplicate table names.')
  }
  const records = candidate.records as Record<string, unknown>
  const recordKeys = Object.keys(records)
  if (recordKeys.length !== candidate.tables.length ||
      recordKeys.some(key => !candidate.tables!.includes(key as DatasetName))) {
    throw new Error('The backup data does not match its table manifest.')
  }
  let recordCount = 0
  for (const table of candidate.tables) {
    const rows = records[table]
    if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) {
      throw new Error(`The ${table} dataset is not a list of records.`)
    }
    recordCount += rows.length
  }
  if (recordCount > MAX_RECORDS) throw new Error(`The backup exceeds the ${MAX_RECORDS.toLocaleString()} record safety limit.`)
  if (!candidate.filters || typeof candidate.filters !== 'object' ||
      !(candidate.filters.dateFrom === null || isDate(candidate.filters.dateFrom)) ||
      !(candidate.filters.dateTo === null || isDate(candidate.filters.dateTo))) {
    throw new Error('The backup date range is invalid.')
  }
  if (candidate.filters.dateFrom && candidate.filters.dateTo &&
      candidate.filters.dateFrom > candidate.filters.dateTo) {
    throw new Error('The backup date range is reversed.')
  }
  return candidate as BackupPackage
}

function isDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)) &&
    new Date(`${value}T00:00:00.000Z`).toISOString().startsWith(value)
}

function nextDate(value: string) {
  return new Date(Date.parse(`${value}T00:00:00.000Z`) + 86400000).toISOString()
}

async function authorize(req: Request): Promise<Context | Response> {
  const url = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceRoleKey) return response(500, { error: 'Supabase server credentials are not configured.' })

  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return response(401, { error: 'Missing authorization token.' })

  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user) return response(401, { error: 'Invalid authorization token.' })
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('role,status')
    .eq('id', data.user.id)
    .single()
  if (profileError || profile?.role !== 'WEB_ADMIN' ||
      ['inactive', 'archived'].includes(String(profile.status || '').toLowerCase())) {
    return response(403, { error: 'Only active Web Admins can manage backups.' })
  }
  return { admin, user: data.user }
}

function validateSelection(value: unknown): DatasetName[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > Object.keys(DATASETS).length ||
      !value.every(isDataset) || new Set(value).size !== value.length) {
    throw new Error('Select one or more supported data sets.')
  }
  return value
}

function validateDateRange(dateFrom: unknown, dateTo: unknown) {
  const from = dateFrom === '' || dateFrom === undefined ? null : dateFrom
  const to = dateTo === '' || dateTo === undefined ? null : dateTo
  if ((from !== null && !isDate(from)) || (to !== null && !isDate(to))) {
    throw new Error('Enter valid start and end dates.')
  }
  if (from && to && from > to) throw new Error('The start date must not be after the end date.')
  return { dateFrom: from as string | null, dateTo: to as string | null }
}

async function fetchDataset(admin: SupabaseClient, name: DatasetName, from: string | null, to: string | null) {
  const definition = DATASETS[name]
  const rows: Record<string, unknown>[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    let query = admin.from(definition.table).select('*').order(definition.orderColumn).range(offset, offset + PAGE_SIZE - 1)
    if ('secondaryOrderColumn' in definition) query = query.order(definition.secondaryOrderColumn)
    if ('role' in definition) query = query.eq('role', definition.role)
    if (!('role' in definition)) {
      if (from) query = query.gte(definition.dateColumn, from)
      if (to) query = query.lt(definition.dateColumn, nextDate(to))
    }
    const { data, error } = await query
    if (error) {
      console.error('Could not read backup dataset.', { table: name, code: error.code || 'unknown' })
      throw new Error(`Could not read the ${name} dataset. Check that the supported schema is deployed.`)
    }
    rows.push(...(data || []) as Record<string, unknown>[])
    if (rows.length > MAX_RECORDS) throw new Error(`The backup exceeds the ${MAX_RECORDS.toLocaleString()} record safety limit.`)
    if (!data || data.length < PAGE_SIZE) break
  }
  return rows
}

function importPath(path: unknown, userId: string) {
  if (typeof path !== 'string' || !new RegExp(`^incoming/${userId}/[0-9a-f-]{36}\\.easpobackup$`, 'i').test(path)) {
    throw new Error('The uploaded backup reference is invalid.')
  }
  return path
}

async function loadUploadedBackup(admin: SupabaseClient, path: string) {
  const { data, error } = await admin.storage.from(BUCKET).download(path)
  if (error || !data) throw new Error('The uploaded backup file could not be read.')
  if (data.size > MAX_FILE_BYTES) throw new Error('The uploaded backup exceeds the 10 MiB limit.')
  return decryptBackup(new Uint8Array(await data.arrayBuffer()))
}

function preview(backup: BackupPackage, validatedCounts: Record<string, number>) {
  const tables = backup.tables.map(table => ({
    name: table,
    records: validatedCounts[table],
  }))
  return {
    ok: true,
    createdAt: backup.createdAt,
    tables,
    totalRecords: tables.reduce((total, table) => total + table.records, 0),
    dateFrom: backup.filters.dateFrom,
    dateTo: backup.filters.dateTo,
    zeroRecordWarnings: tables
      .filter(table => ['sections', 'subjects', 'schedules'].includes(table.name) && table.records === 0)
      .map(table => table.name),
    missingTableWarnings: ['sections', 'subjects', 'schedules']
      .filter(table => !backup.tables.includes(table as DatasetName)),
  }
}

async function signedDownload(admin: SupabaseClient, path: string, name: string) {
  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, 60, { download: name })
  if (error || !data?.signedUrl) throw new Error('A secure download link could not be created.')
  return data.signedUrl
}

serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
  if (req.method !== 'POST') return response(405, { error: 'Method not allowed.' })

  try {
    const context = await authorize(req)
    if (context instanceof Response) return context
    const { admin, user } = context

    let body: Record<string, unknown>
    try {
      body = await req.json()
    } catch {
      return response(400, { error: 'Invalid request body.' })
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return response(400, { error: 'Invalid request body.' })
    }

    if (body.action === 'create') {
      const tables = validateSelection(body.tables)
      const filters = validateDateRange(body.dateFrom, body.dateTo)
      const startedAt = new Date().toISOString()
      const runId = crypto.randomUUID()
      const { error: startError } = await admin.from('system_backup_runs').insert({
        id: runId,
        status: 'running',
        started_at: startedAt,
        result: 'Selective encrypted data backup is in progress.',
        backup_type: 'data_export',
        included_tables: tables,
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
        actor_id: user.id,
      })
      if (startError) {
        console.error('Could not create selective backup history record.', { code: startError.code || 'unknown' })
        return response(500, { error: 'Could not create backup history record.' })
      }

      const objectKey = `data/${runId}.easpobackup`
      try {
        const records: Partial<Record<DatasetName, Record<string, unknown>[]>> = {}
        let totalRecords = 0
        for (const table of tables) {
          records[table] = await fetchDataset(admin, table, filters.dateFrom, filters.dateTo)
          totalRecords += records[table]!.length
          if (totalRecords > MAX_RECORDS) throw new Error(`The backup exceeds the ${MAX_RECORDS.toLocaleString()} record safety limit.`)
        }

        const backup: BackupPackage = {
          format: FORMAT,
          version: 1,
          createdAt: startedAt,
          filters,
          tables,
          records,
        }
        const plain = new TextEncoder().encode(JSON.stringify(backup))
        if (plain.length + MAGIC.length + 12 + 16 > MAX_FILE_BYTES) {
          throw new Error('The backup exceeds the 10 MiB file limit. Select fewer tables or a narrower date range.')
        }
        const encrypted = await encryptBackup(plain)
        const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encrypted)))
          .map(byte => byte.toString(16).padStart(2, '0')).join('')
        const { error: uploadError } = await admin.storage.from(BUCKET).upload(
          objectKey,
          new Blob([encrypted], { type: 'application/octet-stream' }),
          { contentType: 'application/octet-stream', upsert: false },
        )
        if (uploadError) {
          console.error('Could not save encrypted backup object.', { code: uploadError.name || 'unknown' })
          throw new Error('Could not save the encrypted backup to private Supabase Storage.')
        }

        const downloadUrl = await signedDownload(admin, objectKey, `easpo-backup-${startedAt.slice(0, 10)}.easpobackup`)
        const completedAt = new Date().toISOString()
        const { error: finishError } = await admin.from('system_backup_runs').update({
          status: 'verified',
          completed_at: completedAt,
          verified_at: completedAt,
          object_key: objectKey,
          sha256,
          size_bytes: encrypted.length,
          result: `Encrypted selective data backup completed with ${totalRecords} record(s).`,
        }).eq('id', runId).eq('status', 'running')
        if (finishError) throw new Error('The backup file was saved, but its history record could not be finalized.')

        return response(200, {
          ok: true,
          id: runId,
          filename: `easpo-backup-${startedAt.slice(0, 10)}-${runId.slice(0, 8)}.easpobackup`,
          downloadUrl,
          records: totalRecords,
        })
      } catch (error) {
        const { error: cleanupError } = await admin.storage.from(BUCKET).remove([objectKey])
        if (cleanupError) console.error('Failed backup object cleanup.', { code: cleanupError.name || 'unknown' })
        const { error: historyError } = await admin.from('system_backup_runs').update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          result: 'Selective data backup failed. Review server configuration and schema, then retry.',
        }).eq('id', runId).eq('status', 'running')
        if (historyError) console.error('Could not mark selective backup as failed.', { code: historyError.code || 'unknown' })
        throw error
      }
    }

    if (body.action === 'upload-ticket') {
      const fileSize = typeof body.fileSize === 'number' ? body.fileSize : Number.NaN
      if (!Number.isSafeInteger(fileSize) || fileSize <= 0 || fileSize > MAX_FILE_BYTES) {
        return response(400, { error: 'Choose a backup file no larger than 10 MiB.' })
      }
      const path = `incoming/${user.id}/${crypto.randomUUID()}.easpobackup`
      const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: false })
      if (error || !data?.token) return response(500, { error: 'Could not prepare a secure upload for the backup file.' })
      return response(200, { ok: true, path, token: data.token })
    }

    if (body.action === 'preview' || body.action === 'restore' || body.action === 'discard-import') {
      const path = importPath(body.path, user.id)
      if (body.action === 'discard-import') {
        const { error } = await admin.storage.from(BUCKET).remove([path])
        if (error) return response(500, { error: 'The temporary uploaded file could not be removed.' })
        return response(200, { ok: true })
      }
      const backup = await loadUploadedBackup(admin, path)
      if (body.action === 'preview') {
        const { data: validatedCounts, error: validationError } = await admin.rpc('validate_easpo_backup', {
          p_rows: backup.records,
        })
        if (validationError || !validatedCounts || typeof validatedCounts !== 'object') {
          if (validationError) console.error('Backup preview validation failed.', { code: validationError.code || 'unknown' })
          return response(400, { error: 'Backup contents failed schema or required-field validation. No restore was attempted.' })
        }
        return response(200, preview(backup, validatedCounts as Record<string, number>))
      }
      if (body.confirmed !== true) return response(400, { error: 'Explicit restore confirmation is required.' })

      const { data: restored, error: restoreError } = await admin.rpc('restore_easpo_backup', {
        p_rows: backup.records,
      })
      if (restoreError) {
        console.error('Transactional backup restore failed.', { code: restoreError.code || 'unknown' })
        return response(400, { error: 'Restore failed without applying partial changes. Check table compatibility and foreign-key relationships, then use a matching backup.' })
      }
      const { error: cleanupError } = await admin.storage.from(BUCKET).remove([path])
      if (cleanupError) console.error('Could not remove a restored temporary upload.', { code: cleanupError.name || 'unknown' })
      return response(200, {
        ok: true,
        results: restored,
        warning: 'Existing records were not overwritten. Profile rows are restored only when their Supabase Auth user still exists.',
        cleanupWarning: cleanupError ? 'Restore succeeded, but the temporary uploaded file could not be deleted. Use Remove uploaded file to retry.' : null,
      })
    }

    if (body.action === 'download' || body.action === 'delete') {
      if (typeof body.id !== 'string' ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.id)) {
        return response(400, { error: 'A valid backup record is required.' })
      }
      const { data: run, error: runError } = await admin.from('system_backup_runs')
        .select('id,backup_type,status,object_key,started_at')
        .eq('id', body.id)
        .eq('backup_type', 'data_export')
        .maybeSingle()
      if (runError) return response(500, { error: 'Could not load the selected backup record.' })
      if (!run?.object_key) return response(404, { error: 'The selected data backup file is unavailable.' })
      if (body.action === 'download') {
        if (run.status !== 'verified') return response(409, { error: 'Only completed backups can be downloaded.' })
        return response(200, {
          ok: true,
          downloadUrl: await signedDownload(admin, run.object_key, `easpo-backup-${String(run.started_at).slice(0, 10)}.easpobackup`),
        })
      }
      const { error: removeError } = await admin.storage.from(BUCKET).remove([run.object_key])
      if (removeError) return response(500, { error: 'The backup file could not be deleted.' })
      const { error: deleteError } = await admin.from('system_backup_runs').delete().eq('id', run.id)
      if (deleteError) return response(500, { error: 'The backup file was removed, but its history record could not be deleted.' })
      return response(200, { ok: true })
    }

    return response(400, { error: 'Unsupported backup operation.' })
  } catch (error) {
    return response(400, { error: error instanceof Error ? error.message : 'Backup operation failed.' })
  }
})
