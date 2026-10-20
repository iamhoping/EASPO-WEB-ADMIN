import { supabase } from './services/supabaseClient.js'
import { logout } from './services/auth.js'
import { loadSchoolBranding } from './modules/school-branding.js'
import { formatUserName } from './utils/name-format.js'

loadSchoolBranding()

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character])
const gradeKey = value => String(value || '').replace(/^grade\s*/i, '').trim()
const gradeLabel = value => value ? `Grade ${gradeKey(value)}` : '—'
const portalStatus = document.getElementById('portalStatus')
const portalContent = document.getElementById('portalContent')

function showStatus(message, error = false) {
  portalStatus.classList.remove('hidden')
  portalStatus.innerHTML = `<p class="${error ? 'student-portal-error' : ''}">${escapeHtml(message)}</p>`
}

function field(label, value) {
  if (value === null || value === undefined || String(value).trim() === '') return ''
  return `<div class="student-profile-field"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`
}

function section(title, content, emptyMessage = 'No records available.') {
  return `<section class="student-profile-section"><h2>${escapeHtml(title)}</h2>${content || `<p class="student-profile-empty">${escapeHtml(emptyMessage)}</p>`}</section>`
}

async function fetchAllRows(buildQuery) {
  const rows = []
  for (let start = 0; ; start += 1000) {
    const { data, error } = await buildQuery().range(start, start + 999)
    if (error) return { data: null, error }
    rows.push(...(data || []))
    if (!data || data.length < 1000) return { data: rows, error: null }
  }
}

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString()
}

async function loadStudentPortal() {
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    window.location.replace('index.html')
    return
  }

  const { data: account, error: accountError } = await supabase.from('profiles')
    .select('id,name,email,role,status,linked_student_id,relation,contact')
    .eq('id', user.id)
    .single()
  if (accountError || !account || !['STUDENT', 'PARENT'].includes(account.role) ||
      ['inactive', 'archived'].includes(String(account.status || '').toLowerCase())) {
    await supabase.auth.signOut()
    window.location.replace('index.html')
    return
  }

  const isParent = account.role === 'PARENT'
  document.getElementById('portalHeading').textContent = isParent ? 'Parent / Guardian Portal' : 'Student Portal'
  document.getElementById('portalSubheading').textContent = isParent
    ? 'View information for your linked child.'
    : 'Your personal, attendance, academic, and class information.'

  const studentId = isParent ? account.linked_student_id : account.id
  if (!studentId) {
    portalContent.classList.remove('hidden')
    portalStatus.classList.add('hidden')
    portalContent.innerHTML = section('Linked Student', '', 'No student is linked to this parent account. Contact your school administrator.')
    return
  }

  const { data: student, error: studentError } = await supabase.from('profiles')
    .select('id,name,email,contact,address,student_id,gender,date_of_birth,guardian_email,grade_level,section_id,status')
    .eq('id', studentId)
    .eq('role', 'STUDENT')
    .single()
  if (studentError || !student) {
    showStatus(studentError?.message || 'The linked student profile could not be loaded.', true)
    return
  }

  showStatus('Loading attendance, academic, and class records...')
  const [attendanceResult, gradesResult, schedulesResult, sectionResult, teacherResult] = await Promise.all([
    fetchAllRows(() => supabase.from('attendance')
      .select('id,attendance_date,status,time_in,time_out,schedule_id,is_late')
      .eq('student_id', student.id)
      .order('attendance_date', { ascending: false })),
    fetchAllRows(() => supabase.from('grades')
      .select('id,teacher_id,subject_id,subject,quarter,score,remarks,created_at')
      .eq('student_id', student.id)
      .order('created_at', { ascending: false })),
    student.section_id
      ? fetchAllRows(() => supabase.from('schedules')
        .select('id,day,start_time,end_time,room,teacher_id,subject_id,subject')
        .eq('section_id', student.section_id)
        .order('day', { ascending: true })
        .order('start_time', { ascending: true }))
      : Promise.resolve({ data: [], error: null }),
    student.section_id
      ? supabase.from('sections').select('id,name,grade_level').eq('id', student.section_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase.rpc('get_student_portal_teacher_names', { p_student_id: student.id }),
  ])

  const attendance = attendanceResult.data
  const grades = gradesResult.data
  const schedules = schedulesResult.data
  const sectionRecord = sectionResult.data
  const failedSections = []
  if (attendanceResult.error) failedSections.push('attendance')
  if (gradesResult.error) failedSections.push('academic')
  if (schedulesResult.error) failedSections.push('class schedule')
  if (sectionResult.error) failedSections.push('section')
  if (teacherResult.error) failedSections.push('teacher names')

  const uniqueAttendance = []
  const seen = new Set()
  for (const record of attendance || []) {
    const key = record.schedule_id
      ? `${record.attendance_date}:${record.schedule_id}`
      : `${record.attendance_date}:no-schedule:${record.status}:${record.time_in || ''}:${record.time_out || ''}`
    if (seen.has(key)) continue
    seen.add(key)
    uniqueAttendance.push(record)
  }
  const counts = { present: 0, absent: 0, late: 0, excused: 0 }
  for (const record of uniqueAttendance) {
    const status = String(record.status || '').toLowerCase()
    if (status === 'late' || (status === 'present' && record.is_late)) counts.late += 1
    else if (status === 'present') counts.present += 1
    else if (status === 'absent') counts.absent += 1
    else if (status === 'excused') counts.excused += 1
  }
  const countable = Object.values(counts).reduce((sum, count) => sum + count, 0)
  const attendanceRate = countable
    ? `${Math.round(((counts.present + counts.late) / countable) * 100)}%`
    : '—'
  const attendanceSummary = `<div class="student-profile-fields">${[
    field('Total Present', counts.present),
    field('Total Absent', counts.absent),
    field('Total Late', counts.late),
    field('Total Excused', counts.excused),
    field('Total Attendance Records', uniqueAttendance.length),
    field('Attendance Percentage', attendanceRate),
  ].join('')}</div>`

  const scheduleById = new Map((schedules || []).map(schedule => [String(schedule.id), schedule]))
  const [subjectsResult, parentResult] = await Promise.all([
    supabase.from('subjects').select('id,name,code').order('name', { ascending: true }),
    supabase.rpc('get_student_portal_guardians', { p_student_id: student.id }),
  ])
  if (subjectsResult.error) failedSections.push('subject names')
  if (parentResult.error) failedSections.push('guardian information')
  const subjectNames = new Map((subjectsResult.data || []).map(subject => [
    String(subject.id), subject.name || subject.code || `Subject ${subject.id}`,
  ]))
  const teacherNames = new Map((teacherResult.data || []).map(teacher => [
    String(teacher.id), formatUserName(teacher.name),
  ]))

  const personal = `<div class="student-profile-fields">${[
    field('LRN Number', student.student_id),
    field('Full Name', formatUserName(student.name)),
    field('Gender', student.gender),
    field('Date of Birth', formatDate(student.date_of_birth)),
    field('Address', student.address),
    field('Contact Number', student.contact),
    field('Email Address', student.email),
    field('Grade Level', student.grade_level ? gradeLabel(student.grade_level) : ''),
    field('Section', sectionRecord?.name),
    field('Student Status', student.status || 'active'),
  ].join('')}</div>`
  const attendanceRows = uniqueAttendance.map(record => {
    const schedule = scheduleById.get(String(record.schedule_id))
    const subjectName = schedule?.subject || subjectNames.get(String(schedule?.subject_id)) || '—'
    const status = record.is_late && String(record.status).toLowerCase() === 'present' ? 'Late' : record.status || '—'
    return `<tr><td>${escapeHtml(formatDate(record.attendance_date))}</td><td>${escapeHtml(subjectName)}</td><td>${escapeHtml(schedule?.day || '—')}</td><td>${escapeHtml(schedule ? `${schedule.start_time || '—'}–${schedule.end_time || '—'}` : '—')}</td><td>${escapeHtml(schedule?.room || '—')}</td><td>${escapeHtml(record.time_in || '—')}</td><td>${escapeHtml(record.time_out || '—')}</td><td>${escapeHtml(status)}</td></tr>`
  }).join('')
  const attendanceContent = `${attendanceSummary}<div class="table-wrap"><table><thead><tr><th>Date</th><th>Subject</th><th>Day</th><th>Schedule</th><th>Room</th><th>Time In</th><th>Time Out</th><th>Status</th></tr></thead><tbody>${attendanceRows || '<tr><td colspan="8">No attendance records.</td></tr>'}</tbody></table></div>`

  const recordedAverage = grades?.length
    ? (grades.reduce((sum, grade) => sum + Number(grade.score || 0), 0) / grades.length).toFixed(1)
    : '—'
  const gradeRows = (grades || []).map(grade => `<tr><td>${escapeHtml(grade.subject || subjectNames.get(String(grade.subject_id)) || '—')}</td><td>${escapeHtml(grade.quarter || '—')}</td><td>${escapeHtml(grade.score ?? '—')}</td><td>${escapeHtml(teacherNames.get(String(grade.teacher_id)) || '—')}</td><td>${escapeHtml(formatDate(grade.created_at))}</td></tr>`).join('')
  const academicContent = `${field('Average of recorded grades', recordedAverage)}<div class="table-wrap"><table><thead><tr><th>Subject</th><th>Quarter</th><th>Grade</th><th>Teacher</th><th>Date</th></tr></thead><tbody>${gradeRows || '<tr><td colspan="5">No grade records.</td></tr>'}</tbody></table></div>`

  const scheduleRows = (schedules || []).map(schedule => `<tr><td>${escapeHtml(schedule.subject || subjectNames.get(String(schedule.subject_id)) || '—')}</td><td>${escapeHtml(schedule.day || '—')}</td><td>${escapeHtml(`${schedule.start_time || '—'}–${schedule.end_time || '—'}`)}</td><td>${escapeHtml(schedule.room || '—')}</td><td>${escapeHtml(teacherNames.get(String(schedule.teacher_id)) || '—')}</td></tr>`).join('')
  const scheduleContent = `<div class="student-profile-fields">${field('Current Grade and Section', `${student.grade_level ? gradeLabel(student.grade_level) : ''}${sectionRecord?.name ? `${student.grade_level ? ' · ' : ''}${sectionRecord.name}` : ''}`)}</div><div class="table-wrap"><table><thead><tr><th>Subject</th><th>Day</th><th>Time</th><th>Room</th><th>Teacher</th></tr></thead><tbody>${scheduleRows || '<tr><td colspan="5">No class schedules available.</td></tr>'}</tbody></table></div>`
  const parentContent = (parentResult.data || []).map(parent => `<div class="student-profile-fields">${field('Guardian Email', formatUserName(parent.name))}${field('Relationship', parent.relation)}${field('Contact Number', parent.contact)}${field('Email Address', parent.email)}</div>`).join('') ||
    (student.guardian_email ? field('Guardian Email', student.guardian_email) : '')

  portalStatus.classList.add('hidden')
  portalContent.classList.remove('hidden')
  portalContent.innerHTML = `
    <h2 class="student-profile-title">${escapeHtml(formatUserName(student.name))}</h2>
    ${failedSections.length ? `<p class="student-profile-notice">Some information could not be loaded: ${escapeHtml([...new Set(failedSections)].join(', '))}. Refresh or contact the school administrator.</p>` : ''}
    ${section('Personal Information', personal)}
    ${section('Attendance Summary and History', attendanceResult.error ? '' : attendanceContent, attendanceResult.error?.message || 'No attendance records are recorded.')}
    ${section('Academic Performance', gradesResult.error ? '' : academicContent, gradesResult.error?.message || 'No grade records are recorded.')}
    ${section('Enrollment and Class Information', schedulesResult.error ? '' : scheduleContent, schedulesResult.error?.message || 'No class schedules are assigned.')}
    ${section('Parent/Guardian Information', parentContent, parentResult.error?.message || 'No guardian details are recorded.')}`
}

document.getElementById('portalLogout')?.addEventListener('click', logout)
loadStudentPortal().catch(error => {
  console.error('Student portal load failed:', error)
  showStatus(error.message || 'The student profile could not be loaded.', true)
})
