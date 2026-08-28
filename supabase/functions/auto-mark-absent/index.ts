import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SCHOOL_TIME_ZONE = 'Asia/Manila'
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type Schedule = Record<string, unknown>
type Student = { id: string; name: string | null; guardian_email: string | null }

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

function schoolParts(date = new Date()) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: SCHOOL_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'long',
  }).formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value])) as Record<string, string>
}

function value(row: Schedule, names: string[]) {
  for (const name of names) if (row[name] !== undefined && row[name] !== null && row[name] !== '') return row[name]
  return null
}

function normalizedDay(day: unknown) { return String(day ?? '').trim().toLowerCase().slice(0, 3) }
function timeMinutes(time: unknown) {
  const [hour = '0', minute = '0'] = String(time ?? '00:00').split(':')
  return Number(hour) * 60 + Number(minute)
}
function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char] as string))
}

async function sendGuardianEmail(student: Student, schedule: Schedule, attendanceDate: string) {
  const apiKey = Deno.env.get('EMAIL_API_KEY')
  const from = Deno.env.get('EMAIL_FROM')
  if (!student.guardian_email?.trim()) {
    console.warn(`[AUTO-ABSENT] Guardian email unavailable for student ${student.id}`)
    return false
  }
  if (!apiKey || !from) {
    console.error('[AUTO-ABSENT] Email is not configured (EMAIL_API_KEY and EMAIL_FROM are required)')
    return false
  }
  const subject = String(value(schedule, ['subject_name', 'subject', 'subject_title', 'subject_code']) ?? 'Scheduled class')
  const section = String(value(schedule, ['section_name', 'section']) ?? '')
  const start = String(value(schedule, ['start_time', 'time_start', 'start']) ?? '')
  const name = escapeHtml(student.name || 'your child')
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      sender: { email: from, name: 'EASPO Attendance System' },
      to: [{ email: student.guardian_email.trim() }],
      subject: 'Attendance Notification - Your Child Was Marked Absent',
      htmlContent: `<p>Dear Parent/Guardian,</p><p>This is to inform you that <strong>${name}</strong> was marked absent for today's scheduled class.</p><p>Date: ${escapeHtml(attendanceDate)}<br>Schedule: ${escapeHtml(start)}<br>Subject: ${escapeHtml(subject)}${section ? `<br>Section: ${escapeHtml(section)}` : ''}</p><p>If your child arrived late or has a valid reason, please contact the school.</p><p>Thank you.<br>EASPO Attendance System</p>`,
    }),
  })
  if (!response.ok) {
    console.error(`[AUTO-ABSENT] Brevo email failed for student ${student.id}: ${response.status}`)
    return false
  }
  return true
}

serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })

  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) return json(500, { error: 'Supabase server credentials are not configured' })
  const supabase = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const parts = schoolParts()
  const today = `${parts.year}-${parts.month}-${parts.day}`
  const nowMinutes = Number(parts.hour) * 60 + Number(parts.minute)
  let markedAbsent = 0
  let emailsSent = 0
  console.log(`[AUTO-ABSENT] Starting attendance check: ${today} ${parts.hour}:${parts.minute} ${SCHOOL_TIME_ZONE}`)

  try {
    const { data: schedules, error: schedulesError } = await supabase.from('schedules').select('*')
    if (schedulesError) throw schedulesError
    for (const schedule of schedules || []) {
      const status = String(schedule.status ?? '').toLowerCase()
      const scheduleDate = value(schedule, ['schedule_date', 'date', 'scheduled_date'])
      const scheduleDay = value(schedule, ['day_of_week', 'day', 'weekday'])
      const activeToday = (schedule.active !== false) && !['inactive', 'cancelled', 'canceled'].includes(status)
        && (scheduleDate || scheduleDay)
        && (!scheduleDate || String(scheduleDate).slice(0, 10) === today)
        && (!scheduleDay || normalizedDay(scheduleDay) === normalizedDay(parts.weekday))
      if (!activeToday || nowMinutes < timeMinutes(value(schedule, ['start_time', 'time_start', 'start'])) + 60) continue

      const scheduleId = value(schedule, ['id', 'schedule_id'])
      const assignedStudent = value(schedule, ['student_id', 'profile_id'])
      const assignedSection = value(schedule, ['section_id', 'section'])
      if (!scheduleId || (!assignedStudent && !assignedSection)) {
        console.warn(`[AUTO-ABSENT] Skipping malformed schedule ${String(scheduleId ?? 'unknown')}`)
        continue
      }
      let query = supabase.from('profiles').select('id, name, guardian_email').eq('role', 'STUDENT').eq('status', 'active')
      query = assignedStudent ? query.eq('id', assignedStudent) : query.eq('section_id', assignedSection)
      const { data: students, error: studentsError } = await query
      if (studentsError) { console.error(`[AUTO-ABSENT] Student lookup failed for ${scheduleId}: ${studentsError.message}`); continue }

      for (const student of (students || []) as Student[]) {
        const { data: existing, error: attendanceError } = await supabase.from('attendance').select('*')
          .eq('student_id', student.id).eq('schedule_id', scheduleId).eq('attendance_date', today).maybeSingle()
        if (attendanceError) { console.error(`[AUTO-ABSENT] Attendance lookup failed for ${student.id}: ${attendanceError.message}`); continue }
        if (existing?.status === 'present') continue

        let attendance = existing
        if (!attendance) {
          const { data, error } = await supabase.from('attendance').insert({
            student_id: student.id, section_id: assignedSection, schedule_id: scheduleId, attendance_date: today,
            status: 'absent', time_in: null, is_late: false, guardian_email_sent: false,
          }).select().single()
          // The unique index makes a concurrent scanner/worker safe. Re-read on conflict.
          if (error?.code === '23505') {
            const reread = await supabase.from('attendance').select('*').eq('student_id', student.id).eq('schedule_id', scheduleId).eq('attendance_date', today).maybeSingle()
            attendance = reread.data
          } else if (error) { console.error(`[AUTO-ABSENT] Could not mark ${student.id} absent: ${error.message}`); continue }
          else { attendance = data; markedAbsent++; console.log(`[AUTO-ABSENT] Marked student absent: ${student.id}`) }
        }
        if (attendance?.status !== 'absent' || attendance.guardian_email_sent) continue
        // Atomically claim the boolean before talking to the provider.  A second
        // worker sees zero returned rows and must not send a duplicate email.
        const { data: claimed, error: claimError } = await supabase.from('attendance')
          .update({ guardian_email_sent: true }).eq('id', attendance.id).eq('guardian_email_sent', false).select('id')
        if (claimError || !claimed?.length) continue
        if (await sendGuardianEmail(student, schedule, today)) {
          emailsSent++
          console.log(`[AUTO-ABSENT] Guardian email sent for student ${student.id}`)
        } else {
          // Only a failed delivery becomes eligible for a later retry.
          const { error } = await supabase.from('attendance').update({ guardian_email_sent: false }).eq('id', attendance.id).eq('guardian_email_sent', true)
          if (error) console.error(`[AUTO-ABSENT] Email retry flag reset failed for ${student.id}: ${error.message}`)
        }
      }
    }
    console.log('[AUTO-ABSENT] Completed')
    return json(200, { ok: true, date: today, markedAbsent, emailsSent })
  } catch (error) {
    console.error('[AUTO-ABSENT] Failed:', error)
    return json(500, { error: error instanceof Error ? error.message : 'Unknown error' })
  }
})
