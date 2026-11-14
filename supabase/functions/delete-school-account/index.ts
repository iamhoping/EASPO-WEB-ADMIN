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

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders })
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

  const { data: caller, error: callerProfileError } = await adminClient
    .from('profiles')
    .select('role,status')
    .eq('id', callerData.user.id)
    .single()
  if (callerProfileError || caller?.role !== 'WEB_ADMIN' ||
      ['inactive', 'archived', 'deleted'].includes(String(caller.status || '').toLowerCase())) {
    return jsonResponse(403, { error: 'Only active Web Admins can delete accounts.' })
  }

  let body: { userId?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse(400, { error: 'Invalid request body.' })
  }

  const userId = typeof body.userId === 'string' ? body.userId.trim() : ''
  if (!userId) return jsonResponse(400, { error: 'A valid account is required.' })
  if (userId === callerData.user.id) {
    return jsonResponse(400, { error: 'You cannot delete your own account.' })
  }

  const { data: target, error: targetError } = await adminClient
    .from('profiles')
    .select('id,name,role,status')
    .eq('id', userId)
    .maybeSingle()
  if (targetError) return jsonResponse(500, { error: targetError.message })
  if (!target) return jsonResponse(404, { error: 'The selected account was not found.' })
  if (String(target.status || '').toLowerCase() === 'deleted') {
    return jsonResponse(409, { error: 'This account is already deactivated.' })
  }

  // Preserve both the profile and its Auth identity.  "Delete" is reversible
  // deactivation, not a destructive operation.
  const { error: authError } = await adminClient.auth.admin.updateUserById(userId, {
    ban_duration: '876000h',
  })
  if (authError) return jsonResponse(400, { error: authError.message })

  const { error: profileUpdateError } = await adminClient
    .from('profiles')
    .update({ status: 'deleted' })
    .eq('id', userId)
  if (profileUpdateError) {
    await adminClient.auth.admin.updateUserById(userId, { ban_duration: 'none' })
    return jsonResponse(500, { error: 'The account could not be deactivated. No records were removed.' })
  }

  await adminClient.from('activity_logs').insert({
    actor_id: callerData.user.id, actor_role: caller.role, action: 'account_deactivated',
    table_name: 'profiles', record_id: userId,
    before_data: target, after_data: { ...target, status: 'deleted' },
  })
  return jsonResponse(200, { ok: true, status: 'deleted' })
})
