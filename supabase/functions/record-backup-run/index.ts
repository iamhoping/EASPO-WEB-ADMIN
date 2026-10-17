import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-backup-runner-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function response(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function constantTimeEqual(left: string, right: string) {
  const encoder = new TextEncoder()
  const leftBytes = encoder.encode(left)
  const rightBytes = encoder.encode(right)
  let difference = leftBytes.length ^ rightBytes.length
  const maxLength = Math.max(leftBytes.length, rightBytes.length)
  for (let index = 0; index < maxLength; index += 1) {
    difference |= (leftBytes[index] || 0) ^ (rightBytes[index] || 0)
  }
  return difference === 0
}

serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
  if (req.method !== 'POST') return response(405, { error: 'Method not allowed.' })

  const configuredSecret = Deno.env.get('BACKUP_RUNNER_SECRET')
  const suppliedSecret = req.headers.get('x-backup-runner-secret') || ''
  if (!configuredSecret || !constantTimeEqual(suppliedSecret, configuredSecret)) {
    return response(401, { error: 'Unauthorized backup runner.' })
  }

  const url = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceRoleKey) return response(500, { error: 'Backup history service is not configured.' })

  let body: {
    event?: string
    runId?: string
    startedAt?: string
    completedAt?: string
    objectKey?: string
    sha256?: string
    sizeBytes?: number
    result?: string
  }
  try {
    body = await req.json()
  } catch {
    return response(400, { error: 'Invalid request body.' })
  }

  const runId = body.runId || ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId)) {
    return response(400, { error: 'A valid backup run ID is required.' })
  }

  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
  if (body.event === 'started') {
    if (!body.startedAt || !Number.isFinite(Date.parse(body.startedAt))) {
      return response(400, { error: 'A valid backup start time is required.' })
    }
    const { data, error } = await admin.from('system_backup_runs').insert({
      id: runId,
      status: 'running',
      started_at: body.startedAt,
      result: 'PostgreSQL dump, encryption, upload, and remote checksum verification are in progress.',
    }).select('id')
    if (error) {
      console.error('Could not create backup history row:', error.message)
      return response(500, { error: 'Could not create backup history record.' })
    }
    return response(201, { ok: true, id: data?.[0]?.id })
  }

  if (!body.completedAt || !Number.isFinite(Date.parse(body.completedAt))) {
    return response(400, { error: 'A valid backup completion time is required.' })
  }

  if (body.event === 'verified') {
    if (!body.objectKey?.startsWith('backups/easpo-db/') ||
        body.objectKey.includes('..') ||
        !/^[0-9a-f]{64}$/.test(body.sha256 || '') ||
        !Number.isSafeInteger(body.sizeBytes) || (body.sizeBytes || 0) <= 0) {
      return response(400, { error: 'Valid object key, SHA-256, and size are required to verify a backup.' })
    }
    const { data, error } = await admin.from('system_backup_runs').update({
      status: 'verified',
      completed_at: body.completedAt,
      verified_at: body.completedAt,
      object_key: body.objectKey,
      sha256: body.sha256,
      size_bytes: body.sizeBytes,
      result: 'Encrypted PostgreSQL archive validated, uploaded, downloaded, and checksum-verified. Restore testing is a separate operator task.',
    }).eq('id', runId).eq('status', 'running').select('id')
    if (error) {
      console.error('Could not mark backup verified:', error.message)
      return response(500, { error: 'Could not finalize backup history record.' })
    }
    if (data?.length !== 1) return response(409, { error: 'Backup run was not in the running state.' })
    return response(200, { ok: true, id: runId })
  }

  if (body.event === 'failed') {
    const safeResult = String(body.result || 'Backup failed.')
      .replace(/[\r\n\t]+/g, ' ')
      .slice(0, 1000)
    const { data, error } = await admin.from('system_backup_runs').update({
      status: 'failed',
      completed_at: body.completedAt,
      result: safeResult,
    }).eq('id', runId).eq('status', 'running').select('id')
    if (error) {
      console.error('Could not mark backup failed:', error.message)
      return response(500, { error: 'Could not update failed backup history record.' })
    }
    if (data?.length !== 1) return response(409, { error: 'Backup run was not in the running state.' })
    return response(200, { ok: true, id: runId })
  }

  return response(400, { error: 'Unsupported backup event.' })
})
