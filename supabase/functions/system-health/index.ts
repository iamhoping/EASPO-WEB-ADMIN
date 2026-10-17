import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function response(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function latestComponentEvent(events: Record<string, unknown>[], component: string) {
  const componentEvents = events.filter(event => event.component === component)
  const latest = componentEvents[0]
  const lastSuccess = componentEvents.find(event => event.status === 'healthy')
  return {
    status: latest?.status || 'unknown',
    latestAttemptAt: latest?.created_at || null,
    lastSuccessAt: lastSuccess?.created_at || null,
    result: latest?.result || 'No execution has been recorded.',
  }
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
    return response(403, { error: 'Only an active Web Admin can view system health.' })
  }

  const checkedAt = new Date().toISOString()
  const [
    { count: profileCount, error: databaseError },
    { data: events, error: eventsError },
    { data: recentErrors, error: errorsQueryError },
  ] = await Promise.all([
    admin.from('profiles').select('id', { count: 'exact', head: true }),
    admin.from('system_health_events')
      .select('component,status,result,details,created_at')
      .order('created_at', { ascending: false })
      .limit(100),
    admin.from('system_health_events')
      .select('component,result,details,created_at')
      .eq('status', 'error')
      .order('created_at', { ascending: false })
      .limit(25),
  ])

  const statusEvents = events || []
  const telemetryError = eventsError || errorsQueryError
  const database = databaseError
    ? { status: 'error', checkedAt, lastSuccessAt: null, result: 'Supabase database query failed.', error: databaseError.message }
    : { status: 'healthy', checkedAt, lastSuccessAt: checkedAt, result: `Database query succeeded; ${profileCount ?? 0} profiles available.` }

  return response(200, {
    api: { status: 'healthy', checkedAt, lastSuccessAt: checkedAt, result: 'Authenticated system-health API responded successfully.' },
    database,
    telemetry: telemetryError
      ? { status: 'warning', result: 'Operational event history could not be loaded.', error: telemetryError.message }
      : { status: 'healthy', result: 'Operational event history loaded.' },
    autoAbsence: latestComponentEvent(statusEvents, 'auto_absence'),
    emailNotifications: latestComponentEvent(statusEvents, 'email_notifications'),
    recentErrors: (recentErrors || [])
      .map(event => ({
        component: event.component,
        result: event.result,
        details: event.details,
        createdAt: event.created_at,
      })),
  })
})
