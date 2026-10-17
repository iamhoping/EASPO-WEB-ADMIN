import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const roles = ['WEB_ADMIN', 'SCHOOL_ADMIN', 'TEACHER', 'STUDENT', 'PARENT', 'SCANNER']

function response(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
  if (req.method !== 'POST') return response(405, { error: 'Method not allowed.' })

  const url = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceRoleKey) return response(500, { error: 'Supabase server credentials are not configured.' })

  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return response(401, { error: 'Missing authorization token.' })

  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data: authData, error: authError } = await admin.auth.getUser(token)
  if (authError || !authData.user) return response(401, { error: 'Invalid authorization token.' })

  const { data: actor, error: actorError } = await admin
    .from('profiles')
    .select('role,status')
    .eq('id', authData.user.id)
    .single()
  if (actorError || actor?.role !== 'WEB_ADMIN' || String(actor.status || '').toLowerCase() === 'inactive') {
    return response(403, { error: 'Only an active Web Admin can change user roles.' })
  }

  let body: { userId?: string; role?: string }
  try {
    body = await req.json()
  } catch {
    return response(400, { error: 'Invalid request body.' })
  }
  const userId = body.userId?.trim()
  const nextRole = typeof body.role === 'string' ? body.role : ''
  if (!userId || !roles.includes(nextRole)) return response(400, { error: 'Select a valid user and role.' })
  if (userId === authData.user.id) return response(403, { error: 'You cannot change your own role.' })

  const { data: target, error: targetError } = await admin
    .from('profiles')
    .select('id,name,role,status')
    .eq('id', userId)
    .single()
  if (targetError || !target || !roles.includes(target.role)) {
    return response(404, { error: 'The selected user was not found or has an unsupported role.' })
  }
  if (target.role === nextRole) return response(200, { ok: true, unchanged: true })

  const before = {
    id: target.id,
    name: target.name,
    role: target.role,
    status: target.status,
  }
  const { data: updated, error: updateError } = await admin
    .from('profiles')
    .update({ role: nextRole })
    .eq('id', userId)
    .eq('role', target.role)
    .select('id,role,status')
    .maybeSingle()
  if (updateError || !updated) {
    return response(409, { error: updateError?.message || 'The user role changed before this update could be applied.' })
  }

  const { error: auditError } = await admin.from('activity_logs').insert({
    actor_id: authData.user.id,
    actor_role: 'WEB_ADMIN',
    action: 'role_changed',
    table_name: 'profiles',
    record_id: userId,
    before_data: before,
    after_data: { ...before, role: updated.role, status: updated.status },
  })
  if (auditError) {
    const { error: rollbackError } = await admin.from('profiles')
      .update({ role: target.role })
      .eq('id', userId)
      .eq('role', nextRole)
    if (rollbackError) {
      console.error('Role rollback failed after audit insertion error:', rollbackError.message)
      return response(500, { error: 'The role changed but could not be audited or rolled back. Contact support immediately.' })
    }
    return response(500, { error: 'The role change was rolled back because it could not be audited.' })
  }

  return response(200, { ok: true })
})
