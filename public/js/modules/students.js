// /js/modules/students.js
import { supabase } from '../services/supabaseClient.js'
import { showToast } from '../ui/toast.js'
import { renderPagination } from '../ui/pagination.js';
import { createAccount, setAccountStatus } from '../services/auth.js'
import { formatUserName, isLastFirstName } from '../utils/name-format.js'

let allStudents = []
let filtered    = []
let currentPage = 1
const PER_PAGE  = 10

const val       = id => (document.getElementById(id)?.value||'').trim()
const openM     = id => document.getElementById(id)?.classList.remove('hidden')
const closeM    = id => document.getElementById(id)?.classList.add('hidden')
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character])
const display = value => escapeHtml(formatUserName(value) || '—')
const gradeKey = value => String(value || '').replace(/^grade\s*/i, '').trim()
const gradeLabel = value => value ? `Grade ${gradeKey(value)}` : '—'
const sectionLabel = (student, sections) => sections.find(section => String(section.id) === String(student.section_id))?.name || '—'
const csvValue = value => `"${String(value ?? '').replace(/"/g, '""')}"`

// ── Load ────────────────────────────────────────────────────
export async function loadStudents() {
  const tbody = document.getElementById('studentsTableBody')
  if (tbody) tbody.innerHTML = `<tr><td colspan="10"><div class="loader"><div class="spinner"></div></div></td></tr>`

  const { data, error } = await supabase
    .from('profiles')
    .select('id,name,email,contact,address,student_id,gender,date_of_birth,guardian_email,grade_level,section_id,status')
    .eq('role','STUDENT')
    .or('status.is.null,status.neq.archived')
    .order('name',{ascending:true})

  if (error) {
    allStudents = []
    render()
    showToast('Students unavailable', error.message, 'error')
    return
  }
  allStudents = data || []
  await Promise.all([loadStudentSections(), loadLinkedGuardians()])
  applyFilters()
}

let allSections = []
let guardiansByStudent = new Map()

async function loadStudentSections() {
  const { data, error } = await supabase.from('sections').select('id,name,grade_level').order('name', { ascending: true })
  if (error) {
    allSections = []
    showToast('Sections unavailable', error.message || 'Could not load student sections.', 'error')
  } else {
    allSections = data || []
  }
  const grades = document.getElementById('gradeFilter')
  if (grades) {
    const selected = grades.value
    grades.replaceChildren(new Option('All Grades', ''))
    const options = [...new Set(allStudents.map(student => gradeKey(student.grade_level)).filter(Boolean))].sort((a, b) => Number(a) - Number(b))
    options.forEach(value => grades.add(new Option(`Grade ${value}`, value)))
    grades.value = selected
  }
  const sectionFilter = document.getElementById('studentSectionFilter')
  if (sectionFilter) {
    const selected = sectionFilter.value
    sectionFilter.replaceChildren(new Option('All Sections', ''))
    allSections.forEach(section => sectionFilter.add(new Option(section.name || 'Unnamed section', String(section.id))))
    sectionFilter.value = selected
  }
}

async function loadLinkedGuardians() {
  guardiansByStudent = new Map()
  const studentIds = allStudents.map(student => student.id).filter(Boolean)
  if (!studentIds.length) return
  const { data, error } = await supabase.from('profiles')
    .select('id,name,email,contact,relation,linked_student_id')
    .eq('role', 'PARENT')
    .in('linked_student_id', studentIds)
    .or('status.is.null,status.neq.archived')
  if (error) {
    showToast('Guardian names unavailable', error.message || 'Could not load linked parent records.', 'error')
    return
  }
  for (const parent of data || []) {
    const linked = guardiansByStudent.get(parent.linked_student_id) || []
    linked.push(parent)
    guardiansByStudent.set(parent.linked_student_id, linked)
  }
}

// ── Filter ──────────────────────────────────────────────────
export function applyFilters() {
  const q  = val('studentSearch').toLowerCase()
  const gr = document.getElementById('gradeFilter')?.value || ''
  const sec = document.getElementById('studentSectionFilter')?.value || ''
  const st = document.getElementById('statusFilter')?.value || ''
  filtered = allStudents.filter(s =>
    (s.status || '').toLowerCase() !== 'archived' &&
    (!q  || (s.name||'').toLowerCase().includes(q)||(s.student_id||'').toLowerCase().includes(q)) &&
    (!gr || gradeKey(s.grade_level)===gr) &&
    (!sec || String(s.section_id || '')===sec) &&
    (!st || (s.status||'active')===st)
  )
  currentPage = 1
  render()
}

// ── Render ──────────────────────────────────────────────────
function render() {
  const tbody   = document.getElementById('studentsTableBody')
  const countEl = document.getElementById('studentsCount')
  const total   = filtered.length
  if (!tbody) return

  if (!total) {
    tbody.innerHTML = `<tr><td colspan="10"><div class="empty-state"><div class="empty-icon">🎒</div><div class="empty-title">No students found</div><div class="empty-sub">Adjust your search or add a new student.</div></div></td></tr>`
    if(countEl) countEl.textContent = '0 students'
    document.getElementById('studentsPagination')?.replaceChildren()
    return
  }

  const start = (currentPage-1)*PER_PAGE
  const slice = filtered.slice(start, start+PER_PAGE)
  const pages = Math.ceil(total/PER_PAGE)

  tbody.innerHTML = slice.map(s => {
    const st = s.status||'active'
    return `
    <tr>
      <td><code style="font-size:.78rem;color:var(--text3)">${escapeHtml(s.student_id || '—')}</code></td>
      <td><button class="student-name-link" type="button" data-view-student="${escapeHtml(s.id)}">${display(s.name)}</button></td>
      <td>${escapeHtml(gradeLabel(s.grade_level))}</td>
      <td>${escapeHtml(sectionLabel(s, allSections))}</td>
      <td>${escapeHtml(s.gender || '—')}</td>
      <td>${escapeHtml(s.address || '—')}</td>
      <td>${escapeHtml(s.contact || '—')}</td>
      <td>${(guardiansByStudent.get(s.id) || []).map(parent => display(parent.name)).join('<br>') || escapeHtml(s.guardian_email || '—')}</td>
      <td><span class="pill ${st==='active'?'pill-green':'pill-grey'}">${escapeHtml(st[0].toUpperCase()+st.slice(1))}</span></td>
      <td><div class="row-acts">
        <button class="btn btn-secondary btn-sm" type="button" data-view-student="${escapeHtml(s.id)}">View Details</button>
        <button class="act-btn" title="Edit"   onclick="openEditStudentModal('${s.id}')">✏️</button>
        ${document.body.dataset.role === 'SCHOOL_ADMIN'
          ? `<button class="btn btn-secondary btn-sm" onclick="setStudentStatus('${s.id}','${st === 'active' ? 'inactive' : 'active'}')">${st === 'active' ? 'Deactivate' : 'Reactivate'}</button>`
          : ''}
        <button class="btn btn-secondary btn-sm" type="button" data-archive-account="${escapeHtml(s.id)}" data-account-role="STUDENT" data-account-name="${escapeHtml(formatUserName(s.name) || 'Student')}">Archive</button>
      </div></td>
    </tr>`
  }).join('')

  if(countEl) countEl.textContent = `Showing ${start+1}–${Math.min(start+PER_PAGE,total)} of ${total} students`
  renderPages('studentsPagination', currentPage, pages, p => { currentPage=p; render() })
}

// ── Add ─────────────────────────────────────────────────────
export async function submitAddStudent() {
  const name         = val('studentName')
  const email        = val('studentEmail')
  const password     = val('studentPassword')
  const student_id   = val('studentId')
  const gender       = val('studentGender')
  const date_of_birth = val('studentDateOfBirth')
  const grade_level  = val('studentGrade')
  const contact      = val('studentContact')
  const address      = val('studentAddress')
  const guardian_email = val('guardianEmail')

  if (!name||!email||!password||!student_id||!grade_level)
    return showToast('Missing fields','Fill all required fields','warning')
  if (!isLastFirstName(name))
    return showToast('Name format required', 'Enter the student name as Last Name, First Name.', 'warning')
  if (student_id.length > 20)
    return showToast('Invalid LRN', 'The LRN number must be 20 characters or fewer.', 'warning')
  if (!(await ensureUniqueLrn(student_id)))
    return showToast('Duplicate LRN', 'That LRN number is already assigned to another student.', 'warning')

  try {
    await createAccount('STUDENT', {
      name: formatUserName(name), email, password, student_id,
      gender: gender || null, date_of_birth: date_of_birth || null, grade_level,
      contact:contact||null, address:address||null,
      guardian_email:guardian_email||null,
    })
    showToast('Student Added', `${name} enrolled`, 'success')
    closeM('addStudentModal')
    document.getElementById('addStudentForm').reset()
    loadStudents()
  } catch(e) {
    showToast('Student not added', e.message.includes('profiles_student_student_id_unique')
      ? 'That LRN number is already assigned to another student.'
      : e.message, 'error')
  }
}

window.setStudentStatus = async function(id, status) {
  try {
    await setAccountStatus(id, 'STUDENT', status)
    showToast('Account updated', `Student account ${status === 'active' ? 'reactivated' : 'deactivated'}.`, 'success')
    await loadStudents()
  } catch (error) {
    showToast('Account not updated', error.message || 'Could not update this student account.', 'error')
  }
}

// ── Edit ─────────────────────────────────────────────────────
export async function openEditStudentModal(id) {
  const {data:s,error} = await supabase.from('profiles').select('*').eq('id',id).single()
  if(error) return showToast('Error','Could not load student','error')
  document.getElementById('editStudentId').value       = s.id
  document.getElementById('editStudentName').value     = formatUserName(s.name)||''
  document.getElementById('editStudentEmail').value    = s.email||''
  document.getElementById('editStudentIdField').value  = s.student_id||''
  document.getElementById('editStudentGender').value   = s.gender||''
  document.getElementById('editStudentDateOfBirth').value = s.date_of_birth||''
  document.getElementById('editStudentGrade').value    = s.grade_level||''
  document.getElementById('editStudentContact').value  = s.contact||''
  document.getElementById('editStudentAddress').value  = s.address||''
  document.getElementById('editGuardianEmail').value    = s.guardian_email||''
  const statusField = document.getElementById('editStudentStatus')
  statusField.value = s.status || ''
  statusField.disabled = document.body.dataset.role === 'SCHOOL_ADMIN'
  openM('editStudentModal')
}

export async function submitEditStudent() {
  const id   = val('editStudentId')
  const name = val('editStudentName')
  const email= val('editStudentEmail')
  const student_id = val('editStudentIdField')
  if(!name||!email||!student_id) return showToast('Missing fields','Name, email, and LRN number are required','warning')
  if (student_id.length > 20)
    return showToast('Invalid LRN', 'The LRN number must be 20 characters or fewer.', 'warning')
  if (!isLastFirstName(name))
    return showToast('Name format required', 'Enter the student name as Last Name, First Name.', 'warning')
  if (!(await ensureUniqueLrn(student_id, id)))
    return showToast('Duplicate LRN', 'That LRN number is already assigned to another student.', 'warning')

  const updates = {
    name: formatUserName(name), email,
    student_id,
    gender       : val('editStudentGender') || null,
    date_of_birth: val('editStudentDateOfBirth') || null,
    grade_level   : val('editStudentGrade')||null,
    contact       : val('editStudentContact')||null,
    address       : val('editStudentAddress')||null,
    guardian_email : val('editGuardianEmail')||null,
  }
  if (document.body.dataset.role !== 'SCHOOL_ADMIN') {
    updates.status = val('editStudentStatus') || null
  }
  const {error} = await supabase.from('profiles').update(updates).eq('id',id)

  if(error) return showToast('Error',error.message.includes('profiles_student_student_id_unique')
    ? 'That LRN number is already assigned to another student.'
    : error.message,'error')
  showToast('Saved',`${formatUserName(name)} updated`,'success')
  closeM('editStudentModal')
  loadStudents()
}

// ── Export ───────────────────────────────────────────────────
function exportCSV() {
  if(!allStudents.length) return showToast('Empty','Nothing to export','warning')
  const h = ['LRN Number','Student Name','Grade Level','Section','Gender','Address','Contact Number','Parent/Guardian','Status']
  const r = allStudents.map(s=>[
    s.student_id,formatUserName(s.name),gradeLabel(s.grade_level),sectionLabel(s, allSections),s.gender,s.address,s.contact,
    (guardiansByStudent.get(s.id) || []).map(parent => formatUserName(parent.name)).join('; ') || s.guardian_email,
    s.status || 'active',
  ].map(csvValue).join(','))
  const a = Object.assign(document.createElement('a'),{
    href:URL.createObjectURL(new Blob([[h,...r].join('\n')],{type:'text/csv'})),download:'students.csv'
  }); a.click()
}

// ── Init ─────────────────────────────────────────────────────
export function initStudentsSection() {
  document.getElementById('addStudentBtn')?.addEventListener('click',()=>openM('addStudentModal'))
  document.getElementById('studentSearch')?.addEventListener('input', applyFilters)
  document.getElementById('gradeFilter')?.addEventListener('change', applyFilters)
  document.getElementById('studentSectionFilter')?.addEventListener('change', applyFilters)
  document.getElementById('statusFilter')?.addEventListener('change', applyFilters)
  document.getElementById('exportStudentsBtn')?.addEventListener('click', exportCSV)
  document.getElementById('studentsTableBody')?.addEventListener('click', event => {
    const button = event.target.closest('[data-view-student]')
    if (button) openStudentProfile(button.dataset.viewStudent)
  })
  loadStudents()
}

async function ensureUniqueLrn(value, currentId = '') {
  const normalized = String(value || '').trim().toLocaleLowerCase()
  if (!normalized) return true
  const { data, error } = await supabase.from('profiles')
    .select('id,student_id')
    .eq('role', 'STUDENT')
    .not('student_id', 'is', null)
  if (error) {
    showToast('LRN validation unavailable', error.message || 'Could not verify this LRN number.', 'error')
    return false
  }
  return !(data || []).some(student =>
    String(student.id) !== String(currentId) &&
    String(student.student_id || '').trim().toLocaleLowerCase() === normalized
  )
}

async function fetchAllRows(buildQuery) {
  const rows = []
  for (let start = 0; ; start += 1000) {
    const { data, error } = await buildQuery().range(start, start + 999)
    if (error) throw error
    rows.push(...(data || []))
    if (!data || data.length < 1000) return rows
  }
}

function profileField(label, value) {
  if (value === null || value === undefined || String(value).trim() === '') return ''
  return `<div class="student-profile-field"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`
}

function profileSection(title, content, emptyText = 'No records available.') {
  return `<section class="student-profile-section"><h3>${escapeHtml(title)}</h3>${content || `<p class="student-profile-empty">${escapeHtml(emptyText)}</p>`}</section>`
}

function renderProfileError(message) {
  const body = document.getElementById('studentProfileBody')
  if (body) body.innerHTML = `<div class="empty-state"><div class="empty-title">Student profile unavailable</div><div class="empty-sub">${escapeHtml(message)}</div></div>`
}

export async function openStudentProfile(studentId) {
  const modal = document.getElementById('studentProfileModal')
  const body = document.getElementById('studentProfileBody')
  if (!modal || !body) return
  modal.classList.remove('hidden')
  body.innerHTML = '<div class="loader"><div class="spinner"></div></div>'

  const { data: student, error: studentError } = await supabase.from('profiles')
    .select('id,name,email,contact,address,student_id,gender,date_of_birth,guardian_email,grade_level,section_id,status')
    .eq('id', studentId)
    .eq('role', 'STUDENT')
    .single()
  if (studentError || !student) {
    renderProfileError(studentError?.message || 'This student could not be found or is not available to your account.')
    return
  }

  const [sectionsResult, attendanceResult, gradesResult, schedulesResult, guardiansResult] = await Promise.allSettled([
    student.section_id
      ? supabase.from('sections').select('id,name,grade_level').eq('id', student.section_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    fetchAllRows(() => supabase.from('attendance')
      .select('id,attendance_date,status,time_in,time_out,schedule_id,is_late')
      .eq('student_id', student.id)
      .order('attendance_date', { ascending: false })),
    fetchAllRows(() => supabase.from('grades')
      .select('id,student_id,teacher_id,subject_id,subject,quarter,score,remarks,created_at')
      .eq('student_id', student.id)
      .order('created_at', { ascending: false })),
    student.section_id
      ? fetchAllRows(() => supabase.from('schedules')
        .select('id,day,start_time,end_time,room,teacher_id,subject_id,subject')
        .eq('section_id', student.section_id)
        .order('day', { ascending: true })
        .order('start_time', { ascending: true }))
      : Promise.resolve([]),
    supabase.from('profiles')
      .select('id,name,email,contact,relation')
      .eq('role', 'PARENT')
      .eq('linked_student_id', student.id)
      .or('status.is.null,status.neq.archived'),
  ])

  const section = sectionsResult.status === 'fulfilled' && !sectionsResult.value.error ? sectionsResult.value.data : null
  const attendance = attendanceResult.status === 'fulfilled' ? attendanceResult.value : null
  const grades = gradesResult.status === 'fulfilled' ? gradesResult.value : null
  const schedules = schedulesResult.status === 'fulfilled' ? schedulesResult.value : null
  const guardians = guardiansResult.status === 'fulfilled' && !guardiansResult.value.error ? (guardiansResult.value.data || []) : null
  const queryErrors = [
    sectionsResult.status === 'rejected' || sectionsResult.value?.error,
    attendanceResult.status === 'rejected',
    gradesResult.status === 'rejected',
    schedulesResult.status === 'rejected',
    guardiansResult.status === 'rejected' || guardiansResult.value?.error,
  ]
  const teacherIds = [...new Set([
    ...(schedules || []).map(schedule => schedule.teacher_id),
    ...(grades || []).map(grade => grade.teacher_id),
  ].filter(Boolean))]
  const [teachersResult, subjectsResult] = await Promise.all([
    teacherIds.length
      ? supabase.from('profiles').select('id,name').in('id', teacherIds).eq('role', 'TEACHER')
      : Promise.resolve({ data: [], error: null }),
    supabase.from('subjects').select('id,name,code').order('name', { ascending: true }),
  ])
  const teacherNames = new Map((teachersResult.data || []).map(teacher => [String(teacher.id), formatUserName(teacher.name)]))
  const subjectNames = new Map((subjectsResult.data || []).map(subject => [
    String(subject.id),
    subject.name || subject.subject_name || subject.code || `Subject ${subject.id}`,
  ]))

  const classInfo = section?.name ? `${section.name}${section.grade_level ? ` · Grade ${gradeKey(section.grade_level)}` : ''}` : ''
  const personal = `<div class="student-profile-fields">${[
    profileField('LRN Number', student.student_id),
    profileField('Full Name', formatUserName(student.name)),
    profileField('Gender', student.gender),
    profileField('Date of Birth', student.date_of_birth),
    profileField('Address', student.address),
    profileField('Contact Number', student.contact),
    profileField('Email Address', student.email),
    profileField('Grade Level', student.grade_level ? gradeLabel(student.grade_level) : ''),
    profileField('Section', section?.name),
    profileField('Student Status', student.status || 'active'),
  ].join('')}</div>`

  const uniqueAttendance = []
  const seenAttendance = new Set()
  for (const row of attendance || []) {
    const key = row.schedule_id
      ? `${row.attendance_date}:${row.schedule_id}`
      : `${row.attendance_date}:no-schedule:${row.status}:${row.time_in || ''}:${row.time_out || ''}`
    if (seenAttendance.has(key)) continue
    seenAttendance.add(key)
    uniqueAttendance.push(row)
  }
  const attendanceCounts = { present: 0, absent: 0, late: 0, excused: 0 }
  for (const row of uniqueAttendance) {
    const status = String(row.status || '').toLowerCase()
    if (status === 'late' || (status === 'present' && row.is_late)) attendanceCounts.late += 1
    else if (status === 'present') attendanceCounts.present += 1
    else if (status === 'absent') attendanceCounts.absent += 1
    else if (status === 'excused') attendanceCounts.excused += 1
  }
  const countedAttendance = Object.values(attendanceCounts).reduce((sum, count) => sum + count, 0)
  const attendancePercent = countedAttendance
    ? `${Math.round(((attendanceCounts.present + attendanceCounts.late) / countedAttendance) * 100)}%`
    : '—'
  const attendanceSummary = `<div class="student-profile-fields">${[
    profileField('Total Present', attendanceCounts.present),
    profileField('Total Absent', attendanceCounts.absent),
    profileField('Total Late', attendanceCounts.late),
    profileField('Total Excused', attendanceCounts.excused),
    profileField('Total Attendance Records', uniqueAttendance.length),
    profileField('Attendance Percentage', attendancePercent),
  ].join('')}</div>`
  const scheduleById = new Map((schedules || []).map(item => [String(item.id), item]))
  const attendanceHistory = uniqueAttendance.map(row => {
    const schedule = scheduleById.get(String(row.schedule_id))
    const subject = schedule?.subject || subjectNames.get(String(schedule?.subject_id)) || '—'
    const time = schedule ? `${schedule.start_time || '—'}–${schedule.end_time || '—'}` : '—'
    const status = row.is_late && String(row.status).toLowerCase() === 'present' ? 'Late' : row.status || '—'
    return `<tr><td>${escapeHtml(row.attendance_date || '—')}</td><td>${escapeHtml(subject)}</td><td>${escapeHtml(schedule?.day || '—')}</td><td>${escapeHtml(time)}</td><td>${escapeHtml(schedule?.room || '—')}</td><td>${escapeHtml(row.time_in || '—')}</td><td>${escapeHtml(row.time_out || '—')}</td><td>${escapeHtml(status)}</td></tr>`
  }).join('')
  const attendanceContent = `${attendanceSummary}<div class="table-wrap"><table><thead><tr><th>Date</th><th>Subject</th><th>Day</th><th>Schedule</th><th>Room</th><th>Time In</th><th>Time Out</th><th>Status</th></tr></thead><tbody>${attendanceHistory || '<tr><td colspan="8">No attendance records.</td></tr>'}</tbody></table></div>`

  const gradeAverage = grades?.length
    ? (grades.reduce((sum, grade) => sum + Number(grade.score || 0), 0) / grades.length).toFixed(1)
    : '—'
  const academicContent = `<div class="student-profile-field"><span>Average of recorded grades</span><strong>${escapeHtml(gradeAverage)}</strong></div><div class="table-wrap"><table><thead><tr><th>Subject</th><th>Quarter</th><th>Grade</th><th>Teacher</th><th>Date</th></tr></thead><tbody>${(grades || []).map(grade => `<tr><td>${escapeHtml(grade.subject || subjectNames.get(String(grade.subject_id)) || (grade.subject_id ? `Subject ${grade.subject_id}` : '—'))}</td><td>${escapeHtml(grade.quarter || '—')}</td><td>${escapeHtml(grade.score ?? '—')}</td><td>${escapeHtml(teacherNames.get(String(grade.teacher_id)) || '—')}</td><td>${escapeHtml(grade.created_at ? new Date(grade.created_at).toLocaleDateString() : '—')}</td></tr>`).join('') || '<tr><td colspan="5">No grade records.</td></tr>'}</tbody></table></div>`
  const classSchedules = (schedules || []).map(schedule =>
    `<tr><td>${escapeHtml(schedule.subject || subjectNames.get(String(schedule.subject_id)) || (schedule.subject_id ? `Subject ${schedule.subject_id}` : '—'))}</td><td>${escapeHtml(schedule.day || '—')}</td><td>${escapeHtml(`${schedule.start_time || '—'}–${schedule.end_time || '—'}`)}</td><td>${escapeHtml(schedule.room || '—')}</td><td>${escapeHtml(teacherNames.get(String(schedule.teacher_id)) || '—')}</td></tr>`
  ).join('')
  const scheduleContent = `<div class="student-profile-fields">${profileField('Current Grade and Section', classInfo)}${profileField('Enrollment Status', student.status || 'active')}</div><div class="table-wrap"><table><thead><tr><th>Subject</th><th>Day</th><th>Time</th><th>Room</th><th>Teacher</th></tr></thead><tbody>${classSchedules || '<tr><td colspan="5">No class schedules available.</td></tr>'}</tbody></table></div>`
  const parentContent = (guardians || []).map(parent => `<div class="student-profile-fields">${profileField('Parent/Guardian Name', formatUserName(parent.name))}${profileField('Relationship', parent.relation)}${profileField('Contact Number', parent.contact)}${profileField('Email Address', parent.email)}</div>`).join('') ||
    (student.guardian_email ? profileField('Guardian Email', student.guardian_email) : '')

  body.innerHTML = `
    <h2 class="student-profile-title">${display(student.name)}</h2>
    ${[...queryErrors, teachersResult.error, subjectsResult.error].some(Boolean) ? '<p class="student-profile-notice">Some profile sections could not be loaded. See the affected section for details.</p>' : ''}
    ${profileSection('Personal Information', personal)}
    ${profileSection('Attendance Summary and History', attendance
      ? attendanceContent
      : `<p class="student-profile-empty">Attendance history could not be loaded: ${escapeHtml(attendanceResult.reason?.message || attendanceResult.value?.error?.message || 'Unknown error.')}</p>`)}
    ${profileSection('Academic Performance', grades
      ? academicContent
      : `<p class="student-profile-empty">Academic records could not be loaded: ${escapeHtml(gradesResult.reason?.message || gradesResult.value?.error?.message || 'Unknown error.')}</p>`)}
    ${profileSection('Enrollment and Class Information', schedules
      ? scheduleContent
      : `<p class="student-profile-empty">Class schedules could not be loaded: ${escapeHtml(schedulesResult.reason?.message || schedulesResult.value?.error?.message || 'Unknown error.')}</p>`)}
    ${profileSection('Parent/Guardian Information', parentContent, 'No linked parent/guardian details are recorded.')}`
}

// ── Pagination util ───────────────────────────────────────────
function renderPages(id, cur, total, onChange) {
  const el = document.getElementById(id);

  if (!el || total <= 1) {
    if (el) el.innerHTML = '';
    return;
  }

  const pages = [];

  // Previous
  if (cur > 1) {
    pages.push({ label: '‹', page: cur - 1 });
  }

  // Numbers
  for (let i = 1; i <= total; i++) {
    if (i === 1 || i === total || Math.abs(i - cur) <= 1) {
      pages.push({
        label: i,
        page: i,
        active: i === cur
      });
    } else if (pages[pages.length - 1]?.label !== '…') {
      pages.push({
        label: '…',
        page: null
      });
    }
  }

  // Next
  if (cur < total) {
    pages.push({ label: '›', page: cur + 1 });
  }

  // Render buttons
  el.innerHTML = pages.map(p => `
    <button
      class="page-btn ${p.active ? 'active' : ''}"
      data-page="${p.page || ''}"
      ${p.page === null ? 'disabled' : ''}
    >
      ${p.label}
    </button>
  `).join('');

  // Click handler
  el.onclick = (e) => {
    const btn = e.target.closest('.page-btn');

    if (!btn) return;

    const page = Number(btn.dataset.page);

    if (!isNaN(page) && page !== cur) {
      onChange(page);
    }
  };
}

// expose for inline onclick
window.openEditStudentModal = openEditStudentModal