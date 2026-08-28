import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SCHOOL_TIME_ZONE = 'Asia/Manila'
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type Schedule = Record<string, unknown>
type Student = { id: string; name: string | null; guardian_email: string | null; section_id: string | null }
type EmailResult = { sent: boolean; reason?: string }

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
  const parsedHour = Number(hour)
  const parsedMinute = Number(minute)
  return Number.isInteger(parsedHour) && Number.isInteger(parsedMinute) && parsedHour >= 0 && parsedHour < 24 && parsedMinute >= 0 && parsedMinute < 60
    ? parsedHour * 60 + parsedMinute
    : null
}
function formatMinutes(minutes: number) { return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}` }
function normalizedStatus(status: unknown) { return String(status ?? '').trim().toLowerCase() }
function isEmail(value: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) }
function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char] as string))
}

async function sendGuardianEmail(student: Student, schedule: Schedule, attendanceDate: string): Promise<EmailResult> {
  const recipient = student.guardian_email?.trim() ?? ''
  // This is intentionally profiles.guardian_email, never profiles.email.
  console.log(`[AUTO-ABSENT][EMAIL] Student name=${student.name ?? 'unknown'}; uuid=${student.id}; profiles.guardian_email=${recipient || 'null/empty'}`)
  if (!recipient) {
    console.warn(`[AUTO-ABSENT][EMAIL] Validation=false; student=${student.id}; skipped because profiles.guardian_email is null, empty, or whitespace`)
    return { sent: false, reason: 'guardian email is empty' }
  }
  if (!isEmail(recipient)) {
    console.warn(`[AUTO-ABSENT][EMAIL] Validation=false; student=${student.id}; skipped because profiles.guardian_email is not a valid email address`)
    return { sent: false, reason: 'guardian email is invalid' }
  }
  console.log(`[AUTO-ABSENT][EMAIL] Validation=true; student=${student.id}`)
  const apiKey = Deno.env.get('EMAIL_API_KEY')
  const from = Deno.env.get('EMAIL_FROM')
  console.log(`[AUTO-ABSENT][EMAIL] EMAIL_API_KEY configured=${Boolean(apiKey)}; EMAIL_FROM=${from || 'not configured'}`)
  if (!apiKey || !from) {
    console.error(`[AUTO-ABSENT][EMAIL] Brevo skipped; student=${student.id}; reason=${!apiKey && !from ? 'EMAIL_API_KEY and EMAIL_FROM are missing' : !apiKey ? 'EMAIL_API_KEY is missing' : 'EMAIL_FROM is missing'}`)
    return { sent: false, reason: 'Brevo credentials are not configured' }
  }
  const subject = String(value(schedule, ['subject_name', 'subject', 'subject_title', 'subject_code']) ?? 'Scheduled class')
  const section = String(value(schedule, ['section_name', 'section']) ?? '')
  const start = String(value(schedule, ['start_time', 'time_start', 'start']) ?? '')
  try {
    console.log(`[AUTO-ABSENT][EMAIL] Attempting Brevo request; student=${student.id}; recipient=${recipient}; from=${from}`)
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST', headers: { 'api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        sender: { email: from, name: 'EASPO Attendance System' }, to: [{ email: recipient }],
        subject: 'Attendance Notification - Your Child Was Marked Absent',
        htmlContent: `<p>Dear Parent/Guardian,</p><p>This is to inform you that <strong>${escapeHtml(student.name || 'your child')}</strong> was marked absent for today's scheduled class.</p><p>Date: ${escapeHtml(attendanceDate)}<br>Schedule: ${escapeHtml(start)}<br>Subject: ${escapeHtml(subject)}${section ? `<br>Section: ${escapeHtml(section)}` : ''}</p><p>If your child arrived late or has a valid reason, please contact the school.</p><p>Thank you.<br>EASPO Attendance System</p>`,
      }),
    })
    const responseBody = await response.text()
    console.log(`[AUTO-ABSENT][EMAIL] Brevo HTTP status=${response.status}; student=${student.id}; response=${responseBody.slice(0, 500) || '(empty)'}`)
    if (!response.ok) {
      console.error(`[AUTO-ABSENT][EMAIL] Brevo rejected email; student=${student.id}`)
      return { sent: false, reason: `Brevo returned ${response.status}` }
    }
    console.log(`[AUTO-ABSENT][EMAIL] Brevo accepted email; student=${student.id}`)
    return { sent: true }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.error(`[AUTO-ABSENT] Brevo request failed for student=${student.id}; error=${reason}`)
    return { sent: false, reason }
  }
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
  console.log(`[AUTO-ABSENT] Philippine now=${today} ${parts.hour}:${parts.minute}; day=${parts.weekday}; timezone=${SCHOOL_TIME_ZONE}`)

  try {
    const { data: allSchedules, error: schedulesError } = await supabase.from('schedules').select('*')
    if (schedulesError) throw schedulesError
    // EASPO is section-based: schedules.section_id = profiles.section_id. Do not query schedules.status.
    const schedulesToday = (allSchedules || []).filter(schedule => normalizedDay(schedule.day) === normalizedDay(parts.weekday))
    console.log(`[AUTO-ABSENT] Schedules total=${allSchedules?.length ?? 0}; schedules found today=${schedulesToday.length}`)

    for (const schedule of schedulesToday) {
      const scheduleId = value(schedule, ['id', 'schedule_id'])
      const sectionId = value(schedule, ['section_id'])
      const startTime = value(schedule, ['start_time', 'time_start', 'start'])
      const startMinutes = timeMinutes(startTime)
      if (!scheduleId || !sectionId || startMinutes === null) {
        console.warn(`[AUTO-ABSENT] Skipping malformed schedule; id=${String(scheduleId)}; sectionId=${String(sectionId)}; startTime=${String(startTime)}`)
        continue
      }
      const thresholdMinutes = startMinutes + 60
      console.log(`[AUTO-ABSENT] Schedule id=${scheduleId}; sectionId=${sectionId}; start=${startTime}; oneHourThreshold=${today} ${formatMinutes(thresholdMinutes)}; now=${formatMinutes(nowMinutes)}`)
      if (nowMinutes < thresholdMinutes) {
        console.log(`[AUTO-ABSENT] Schedule id=${scheduleId} skipped: one-hour threshold has not been reached`)
        continue
      }

      const { data: students, error: studentsError } = await supabase.from('profiles')
        .select('id, name, guardian_email, section_id').eq('role', 'STUDENT').eq('section_id', sectionId)
      if (studentsError) {
        console.error(`[AUTO-ABSENT] Student lookup failed; schedule=${scheduleId}; section=${sectionId}; error=${studentsError.message}`)
        continue
      }
      console.log(`[AUTO-ABSENT] Schedule id=${scheduleId}; students found in section=${students?.length ?? 0}; studentIds=${(students || []).map(student => student.id).join(',') || 'none'}`)

      for (const student of (students || []) as Student[]) {
        const { data: existing, error: attendanceError } = await supabase.from('attendance').select('*')
          .eq('student_id', student.id).eq('schedule_id', scheduleId).eq('attendance_date', today).maybeSingle()
        if (attendanceError) {
          console.error(`[AUTO-ABSENT] Attendance lookup failed; schedule=${scheduleId}; student=${student.id}; error=${attendanceError.message}`)
          continue
        }
        console.log(`[AUTO-ABSENT] Attendance record; schedule=${scheduleId}; student=${student.id}; found=${Boolean(existing)}; status=${existing?.status ?? 'none'}`)
        if (existing && normalizedStatus(existing.status) === 'present') continue

        let attendance = existing
        if (!attendance) {
          const { data, error } = await supabase.from('attendance').insert({
            student_id: student.id, section_id: sectionId, schedule_id: scheduleId,
            subject: value(schedule, ['subject_name', 'subject', 'subject_title', 'subject_code']),
            attendance_date: today, status: 'absent', time_in: null, is_late: false, guardian_email_sent: false,
          }).select().single()
          if (error?.code === '23505') {
            const { data: reread, error: rereadError } = await supabase.from('attendance').select('*')
              .eq('student_id', student.id).eq('schedule_id', scheduleId).eq('attendance_date', today).maybeSingle()
            if (rereadError) console.error(`[AUTO-ABSENT] Duplicate reread failed; schedule=${scheduleId}; student=${student.id}; error=${rereadError.message}`)
            attendance = reread
          } else if (error) {
            console.error(`[AUTO-ABSENT] Could not mark absent; schedule=${scheduleId}; student=${student.id}; error=${error.message}`)
            continue
          } else {
            attendance = data
            markedAbsent++
            console.log(`[AUTO-ABSENT] Marked absent; schedule=${scheduleId}; student=${student.id}`)
          }
        }

        if (!attendance || normalizedStatus(attendance.status) !== 'absent' || attendance.guardian_email_sent) continue
        const email = await sendGuardianEmail(student, schedule, today)
        if (!email.sent) {
          console.log(`[AUTO-ABSENT] Email not sent; schedule=${scheduleId}; student=${student.id}; reason=${email.reason}`)
          continue
        }
        // Brevo has already accepted the message; only now persist the sent flag.
        const { data: updated, error: updateError } = await supabase.from('attendance')
          .update({ guardian_email_sent: true }).eq('id', attendance.id).eq('guardian_email_sent', false).select('id')
        if (updateError || !updated?.length) {
          console.error(`[AUTO-ABSENT] Email was accepted but guardian_email_sent could not be saved; student=${student.id}; error=${updateError?.message ?? 'record was already updated'}`)
          continue
        }
        emailsSent++
        console.log(`[AUTO-ABSENT] Guardian email marked sent; schedule=${scheduleId}; student=${student.id}`)
      }
    }
    console.log(`[AUTO-ABSENT] Completed; markedAbsent=${markedAbsent}; emailsSent=${emailsSent}`)
    return json(200, { ok: true, date: today, markedAbsent, emailsSent })
  } catch (error) {
    console.error('[AUTO-ABSENT] Failed:', error)
    return json(500, { error: error instanceof Error ? error.message : 'Unknown error' })
  }
})
