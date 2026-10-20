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

function titleCaseNamePart(value: string) {
  return value
    .split(/(\s+|[-'’])/)
    .map(part => {
      if (!part || /^\s+$/.test(part) || /^[-'’]$/.test(part)) return part
      if (/^(?:[ivxlcdm]+)\.?$/i.test(part) && (part.length >= 3 || part === part.toLocaleUpperCase())) {
        return part.toLocaleUpperCase()
      }
      const [first, ...rest] = part.toLocaleLowerCase()
      return `${first.toLocaleUpperCase()}${rest.join('')}`
    })
    .join('')
}

function formatUserName(value: string) {
  const normalized = value.trim().replace(/\s+/g, ' ')
  const parts = normalized.split(',').map(part => part.trim()).filter(Boolean)
  if (parts.length < 2) return titleCaseNamePart(normalized)
  return `${titleCaseNamePart(parts[0])}, ${titleCaseNamePart(parts.slice(1).join(' '))}`
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

  const { data: callerProfile, error: profileError } = await adminClient
    .from('profiles')
    .select('role,status')
    .eq('id', callerData.user.id)
    .single()
  if (profileError || !['WEB_ADMIN', 'SCHOOL_ADMIN'].includes(callerProfile?.role) ||
      String(callerProfile.status || '').toLowerCase() === 'inactive') {
    return jsonResponse(403, { error: 'Only authorized school administrators can create accounts.' })
  }

  let body: {
    role?: string
    profile?: Record<string, unknown>
  }
  try {
    body = await req.json()
  } catch {
    return jsonResponse(400, { error: 'Invalid request body.' })
  }

  const role = typeof body.role === 'string' ? body.role : ''
  const profile = body.profile
  if (!['STUDENT', 'TEACHER', 'PARENT'].includes(role || '') || !profile || typeof profile !== 'object') {
    return jsonResponse(400, { error: 'Only student, teacher, and parent accounts can be created.' })
  }
  const inputName = typeof profile.name === 'string' ? profile.name : ''
  const name = formatUserName(inputName)
  if (!name) return jsonResponse(400, { error: 'Name is required.' })
  if (['STUDENT', 'TEACHER'].includes(role) &&
      (!inputName.includes(',') || !inputName.split(',')[0].trim() || !inputName.split(',').slice(1).join(' ').trim())) {
    return jsonResponse(400, { error: 'Enter the name as Last Name, First Name.' })
  }
  if (typeof profile.email !== 'string' || !profile.email.trim() ||
      typeof profile.password !== 'string' || !profile.password.trim()) {
    return jsonResponse(400, { error: 'Email and password are required to create an account.' })
  }
  if (role === 'STUDENT' &&
      (typeof profile.student_id !== 'string' || !profile.student_id.trim() ||
       profile.student_id.trim().length > 20 ||
       typeof profile.grade_level !== 'string' || !profile.grade_level.trim())) {
    return jsonResponse(400, { error: 'A valid LRN number (20 characters or fewer) and grade level are required.' })
  }
  if (role === 'PARENT' && profile.linked_student_id) {
    if (typeof profile.linked_student_id !== 'string') {
      return jsonResponse(400, { error: 'Select a valid linked student.' })
    }
    const { data: linkedStudent, error: linkedStudentError } = await adminClient
      .from('profiles')
      .select('id')
      .eq('id', profile.linked_student_id)
      .eq('role', 'STUDENT')
      .maybeSingle()
    if (linkedStudentError || !linkedStudent) {
      return jsonResponse(400, { error: 'The selected linked student could not be verified.' })
    }
  }

  const fieldsByRole: Record<string, string[]> = {
    STUDENT: ['student_id', 'gender', 'date_of_birth', 'grade_level', 'contact', 'address', 'guardian_email'],
    TEACHER: ['teacher_id', 'department', 'contact'],
    PARENT: ['relation', 'contact', 'address', 'linked_student_id'],
  }
  const profileFields: Record<string, unknown> = {
    name,
    email: profile.email.trim(),
    role,
    status: 'active',
  }
  for (const field of fieldsByRole[role] || []) {
    if (field in profile) profileFields[field] = profile[field] || null
  }

  const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
    email: profile.email.trim(),
    password: profile.password,
    email_confirm: true,
    user_metadata: { name },
  })
  if (authError || !authData.user) {
    return jsonResponse(400, { error: authError?.message || 'Could not create the authentication account.' })
  }

  const { error: insertError } = await adminClient
    .from('profiles')
    .insert({ id: authData.user.id, ...profileFields })
  if (insertError) {
    const { error: rollbackError } = await adminClient.auth.admin.deleteUser(authData.user.id)
    if (rollbackError) {
      console.error('Account rollback failed after profile insertion error:', rollbackError.message)
      return jsonResponse(500, { error: `Profile creation failed and account cleanup failed: ${insertError.message}` })
    }
    if (role === 'STUDENT' && insertError.code === '23505' &&
        insertError.message.includes('profiles_student_student_id_unique')) {
      return jsonResponse(409, { error: 'That LRN number is already assigned to another student.' })
    }
    return jsonResponse(400, { error: insertError.message })
  }

  const { error: auditError } = await adminClient.from('activity_logs').insert({
    actor_id: callerData.user.id,
    actor_role: callerProfile.role,
    action: 'account_created',
    table_name: 'profiles',
    record_id: authData.user.id,
    before_data: null,
    after_data: {
      id: authData.user.id,
      name: profileFields.name,
      role,
      status: 'active',
      ...Object.fromEntries(
        Object.entries(profileFields).filter(([key]) =>
          ['student_id', 'gender', 'date_of_birth', 'teacher_id', 'grade_level', 'section_id', 'department', 'relation', 'linked_student_id'].includes(key)
        )
      ),
    },
  })
  if (auditError) {
    const { error: profileRollbackError } = await adminClient.from('profiles').delete().eq('id', authData.user.id)
    const { error: authRollbackError } = await adminClient.auth.admin.deleteUser(authData.user.id)
    if (profileRollbackError || authRollbackError) {
      console.error('Account rollback failed after audit insertion error:', {
        profile: profileRollbackError?.message,
        auth: authRollbackError?.message,
      })
      return jsonResponse(500, { error: 'Account creation could not be audited or fully rolled back. Contact support.' })
    }
    return jsonResponse(500, { error: 'Account creation was rolled back because it could not be audited.' })
  }

  return jsonResponse(201, { userId: authData.user.id })
})
