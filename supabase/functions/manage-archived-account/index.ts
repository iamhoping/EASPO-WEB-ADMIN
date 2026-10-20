import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
}

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed' })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse(500, { error: 'Supabase server credentials are not configured.' })
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return jsonResponse(401, { error: 'Missing authorization token.' })

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: callerData, error: callerError } = await adminClient.auth.getUser(token)
  if (callerError || !callerData.user) return jsonResponse(401, { error: 'Invalid authorization token.' })
  const { data: caller, error: callerProfileError } = await adminClient
    .from('profiles')
    .select('role,status,name')
    .eq('id', callerData.user.id)
    .single()
  if (callerProfileError || !['WEB_ADMIN', 'SCHOOL_ADMIN'].includes(caller?.role) ||
      ['inactive', 'archived'].includes(String(caller.status || '').toLowerCase())) {
    return jsonResponse(403, { error: 'Only active school administrators can archive or restore accounts.' })
  }

  let body: { action?: string; userId?: string; role?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse(400, { error: 'Invalid request body.' })
  }
  const action = body.action
  const userId = body.userId?.trim()
  const role = body.role
  if (!['archive', 'restore'].includes(action || '') ||
      !userId || !['STUDENT', 'TEACHER', 'PARENT'].includes(role || '')) {
    return jsonResponse(400, { error: 'A valid account and archive or restore action are required.' })
  }
  if (userId === callerData.user.id) return jsonResponse(400, { error: 'Administrators cannot archive their own account.' })

  const { data: target, error: targetError } = await adminClient
    .from('profiles')
    .select('id,name,role,status,section_id,archive_reason,archived_at,archived_by,archived_by_name,archived_section_id')
    .eq('id', userId)
    .single()
  if (targetError || !target || target.role !== role) {
    return jsonResponse(404, { error: 'The selected account was not found or its role has changed.' })
  }
  if (action === 'archive' && String(target.status || '').toLowerCase() === 'archived') {
    return jsonResponse(409, { error: 'This account is already archived.' })
  }
  if (action === 'restore' && String(target.status || '').toLowerCase() !== 'archived') {
    return jsonResponse(409, { error: 'This account is not currently archived.' })
  }

  const previousStatus = target.status || 'active'
  const archived = action === 'archive'
  const archiveReason = role === 'STUDENT' ? 'Graduated' : 'Inactive'
  const profileUpdate = archived
    ? {
        status: 'archived',
        archive_reason: archiveReason,
        archived_at: new Date().toISOString(),
        archived_by: callerData.user.id,
        archived_by_name: caller.name || null,
        archived_section_id: role === 'STUDENT' ? target.section_id : null,
        ...(role === 'STUDENT' ? { section_id: null } : {}),
      }
    : {
        status: 'active',
        archive_reason: null,
        archived_at: null,
        archived_by: null,
        archived_by_name: null,
        archived_section_id: null,
        ...(role === 'STUDENT' ? { section_id: null } : {}),
      }

  const previousAuthBanned = ['inactive', 'archived'].includes(String(previousStatus).toLowerCase())
  const updateAuth = async (banned: boolean) => adminClient.auth.admin.updateUserById(userId, {
    ban_duration: banned ? '876000h' : 'none',
  })

  let profileUpdateQuery = adminClient
    .from('profiles')
    .update(profileUpdate)
    .eq('id', userId)
    .eq('role', role)
  profileUpdateQuery = target.status == null
    ? profileUpdateQuery.is('status', null)
    : profileUpdateQuery.eq('status', target.status)
  const { data: updated, error: updateError } = await profileUpdateQuery.select('id').maybeSingle()
  if (updateError || !updated) {
    return jsonResponse(400, { error: updateError?.message || 'The account changed before it could be updated.' })
  }

  const rollbackProfile = {
    status: previousStatus,
    archive_reason: target.archive_reason,
    archived_at: target.archived_at,
    archived_by: target.archived_by,
    archived_by_name: target.archived_by_name,
    archived_section_id: target.archived_section_id,
    ...(role === 'STUDENT' ? { section_id: target.section_id } : {}),
  }
  const { error: authError } = await updateAuth(archived)
  if (authError) {
    const { data: profileRollback, error: profileRollbackError } = await adminClient.from('profiles')
      .update(rollbackProfile)
      .eq('id', userId)
      .eq('role', role)
      .eq('status', archived ? 'archived' : 'active')
      .select('id')
      .maybeSingle()
    const { error: authRollbackError } = await updateAuth(previousAuthBanned)
    if (profileRollbackError || !profileRollback || authRollbackError) {
      console.error('Archive rollback failed after auth update error:', {
        profile: profileRollbackError?.message,
        auth: authRollbackError?.message,
      })
      return jsonResponse(500, { error: 'Authentication failed and the account could not be fully rolled back. Contact support.' })
    }
    return jsonResponse(400, { error: authError.message })
  }

  const { error: auditError } = await adminClient.from('activity_logs').insert({
    actor_id: callerData.user.id,
    actor_role: caller.role,
    action: archived ? 'account_archived' : 'account_restored',
    table_name: 'profiles',
    record_id: userId,
    before_data: {
      id: target.id, name: target.name, role, status: previousStatus,
      section_id: target.section_id, archive_reason: target.archive_reason,
    },
    after_data: {
      id: target.id, name: target.name, role, ...profileUpdate,
    },
  })
  if (auditError) {
    const { data: profileRollback, error: profileRollbackError } = await adminClient.from('profiles')
      .update(rollbackProfile)
      .eq('id', userId)
      .eq('role', role)
      .eq('status', archived ? 'archived' : 'active')
      .select('id')
      .maybeSingle()
    const { error: authRollbackError } = await updateAuth(previousAuthBanned)
    if (profileRollbackError || !profileRollback || authRollbackError) {
      console.error('Archive rollback failed after audit insertion error:', {
        profile: profileRollbackError?.message,
        auth: authRollbackError?.message,
      })
      return jsonResponse(500, { error: 'The account change could not be audited or fully rolled back. Contact support.' })
    }
    return jsonResponse(500, { error: 'The account change was rolled back because it could not be audited.' })
  }

  return jsonResponse(200, { ok: true })
})
