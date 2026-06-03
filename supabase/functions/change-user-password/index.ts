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

function validPassword(password: string) {
  return password.length >= 8 && /[A-Z]/.test(password) && /\d/.test(password)
}

serve(async req => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    })
  }
  if (req.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed' })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(500, { error: 'Supabase server credentials are not configured.' })
  }

  const authHeader = req.headers.get('Authorization') || ''
  const token = authHeader.replace('Bearer ', '').trim()

  if (!token) return jsonResponse(401, { error: 'Missing authorization token.' })

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: callerData, error: callerError } = await adminClient.auth.getUser(token)
  if (callerError || !callerData.user) {
    return jsonResponse(401, { error: 'Invalid authorization token.' })
  }

  const { data: callerProfile, error: profileError } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', callerData.user.id)
    .single()

  if (profileError || callerProfile?.role !== 'WEB_ADMIN') {
    return jsonResponse(403, { error: 'Only administrators can change user passwords.' })
  }

  let payload: { userId?: string; password?: string; confirmPassword?: string }
  try {
    payload = await req.json()
  } catch {
    return jsonResponse(400, { error: 'Invalid request body.' })
  }

  const userId = payload.userId?.trim()
  const password = payload.password || ''
  const confirmPassword = payload.confirmPassword || ''

  if (!userId) return jsonResponse(400, { error: 'User ID is required.' })
  if (password !== confirmPassword) return jsonResponse(400, { error: 'Passwords do not match.' })
  if (!validPassword(password)) {
    return jsonResponse(400, {
      error: 'Password must be at least 8 characters and include one uppercase letter and one number.',
    })
  }

  const { error: updateError } = await adminClient.auth.admin.updateUserById(userId, {
    password,
  })

  if (updateError) return jsonResponse(400, { error: updateError.message })

  return jsonResponse(200, { ok: true })
})
