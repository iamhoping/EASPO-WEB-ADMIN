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
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders })
  }
  if (req.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed' })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(500, { error: 'Supabase server credentials are not configured.' })
  }

  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return jsonResponse(401, { error: 'Missing authorization token.' })

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: callerData, error: callerError } = await adminClient.auth.getUser(token)
  if (callerError || !callerData.user) return jsonResponse(401, { error: 'Invalid authorization token.' })

  const { data: callerProfile, error: callerProfileError } = await adminClient
    .from('profiles')
    .select('role,status')
    .eq('id', callerData.user.id)
    .single()
  if (callerProfileError || !['WEB_ADMIN', 'SCHOOL_ADMIN'].includes(callerProfile?.role) ||
      String(callerProfile.status || '').toLowerCase() === 'inactive') {
    return jsonResponse(403, { error: 'Only authorized school administrators can deactivate accounts.' })
  }

  let body: { userId?: string; role?: string; status?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse(400, { error: 'Invalid request body.' })
  }

  const userId = body.userId?.trim()
  const role = body.role
  const status = body.status
  if (!userId || !['STUDENT', 'TEACHER', 'PARENT'].includes(role || '') ||
      !['active', 'inactive'].includes(status || '')) {
    return jsonResponse(400, { error: 'A valid student, teacher, or parent account and status are required.' })
  }

  const { data: target, error: targetError } = await adminClient
    .from('profiles')
    .select('id,name,role,status')
    .eq('id', userId)
    .single()
  if (targetError || !target || target.role !== role) {
    return jsonResponse(404, { error: 'The selected account was not found or its role has changed.' })
  }

  const { error: authError } = await adminClient.auth.admin.updateUserById(userId, {
    ban_duration: status === 'inactive' ? '876000h' : 'none',
  })
  if (authError) return jsonResponse(400, { error: authError.message })

  const { data: updatedProfile, error: profileError } = await adminClient
    .from('profiles')
    .update({ status })
    .eq('id', userId)
    .eq('role', role)
    .select('id')
    .maybeSingle()
  if (profileError || !updatedProfile) {
    const { error: rollbackError } = await adminClient.auth.admin.updateUserById(userId, {
      ban_duration: String(target.status || 'active').toLowerCase() === 'inactive' ? '876000h' : 'none',
    })
    if (rollbackError) {
      console.error('Auth status rollback failed after profile update error:', rollbackError.message)
      return jsonResponse(500, { error: `Profile status update failed and auth rollback failed: ${profileError?.message || 'Target role changed during update.'}` })
    }
    return jsonResponse(400, { error: profileError?.message || 'The account role changed before it could be updated.' })
  }

  const { error: auditError } = await adminClient.from('activity_logs').insert({
    actor_id: callerData.user.id,
    actor_role: callerProfile.role,
    action: status === 'inactive' ? 'account_deactivated' : 'account_reactivated',
    table_name: 'profiles',
    record_id: userId,
    before_data: { id: target.id, name: target.name, role, status: target.status },
    after_data: { id: target.id, name: target.name, role, status },
  })
  if (auditError) {
    const { error: profileRollbackError } = await adminClient.from('profiles')
      .update({ status: target.status || 'active' })
      .eq('id', userId)
      .eq('role', role)
    const { error: authRollbackError } = await adminClient.auth.admin.updateUserById(userId, {
      ban_duration: String(target.status || 'active').toLowerCase() === 'inactive' ? '876000h' : 'none',
    })
    if (profileRollbackError || authRollbackError) {
      console.error('Account status rollback failed after audit insertion error:', {
        profile: profileRollbackError?.message,
        auth: authRollbackError?.message,
      })
      return jsonResponse(500, { error: 'Account status could not be audited or fully rolled back. Contact support.' })
    }
    return jsonResponse(500, { error: 'The account status change was rolled back because it could not be audited.' })
  }

  return jsonResponse(200, { ok: true })
})
