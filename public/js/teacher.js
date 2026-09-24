import { supabase } from './services/supabaseClient.js'
import { logout } from './services/auth.js'
import { renderPagination } from './ui/pagination.js'
import { showToast } from './ui/toast.js'

const state = {
  teacher: null,
  schedules: [],
  sections: [],
  subjects: [],
  students: [],
  attendance: [],
  grades: [],
  schedulePage: 1,
  attendancePage: 1,
  gradesPage: 1,
  rowsPerPage: 5
}

const byId = (list, id) => list.find(item => String(item.id) === String(id))
const normalizeText = (value) => (value || '').toString().trim().toLowerCase()
const initials = (name = '') => (name.split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase() || 'T')
const setText = (id, value) => {
  const el = document.getElementById(id)
  if (el) el.textContent = value
}
const getSectionById = (sectionId) => state.sections.find(section => String(section.id) === String(sectionId)) || null
const getSubjectById = (subjectId) => state.subjects.find(subject => String(subject.id) === String(subjectId)) || null

function inferSectionLabel(sectionId) {
  const section = getSectionById(sectionId)
  if (section?.name) return section.name

  const schedule = state.schedules.find(item => String(item.section_id) === String(sectionId))
  if (schedule?.sections?.name) return schedule.sections.name

  const student = state.students.find(item => String(item.section_id) === String(sectionId))
  if (student?.grade_level) return `Grade ${student.grade_level}`
  if (student?.section_id) return `Section ${student.section_id}`
  if (sectionId) return `Section ${String(sectionId).slice(0, 8)}`
  return '—'
}

function getSectionLabel(sectionId) {
  return inferSectionLabel(sectionId)
}

function setupNavigation() {
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', (event) => {
      event.preventDefault()
      const section = link.dataset.section
      document.querySelectorAll('.nav-link').forEach(item => item.classList.toggle('active', item === link))
      document.querySelectorAll('section[id$="Section"]').forEach(panel => {
        const visible = panel.id === `${section}Section`
        panel.classList.toggle('hidden', !visible)
      })

      const sidebar = document.getElementById('sidebar')
      const backdrop = document.getElementById('sidebarBackdrop')
      if (window.innerWidth <= 860 && sidebar && backdrop) {
        sidebar.classList.remove('open')
        backdrop.classList.remove('visible')
        document.body.classList.remove('nav-open')
      }
    })
  })
}

async function loadTeacherProfile() {
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) {
    window.location.href = 'index.html'
    return null
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (profileError || !profile || profile.role !== 'TEACHER') {
    await supabase.auth.signOut()
    window.location.href = 'index.html'
    return null
  }

  state.teacher = profile
  setText('sidebarTeacherName', profile.name || 'Teacher')
  setText('teacherHeaderName', profile.name || 'Teacher Dashboard')
  setText('teacherNameValue', profile.name || 'Teacher')
  const initialsValue = initials(profile.name || 'Teacher')
  const initialsEl = document.getElementById('teacherInitials')
  if (initialsEl) initialsEl.textContent = initialsValue

  const profileName = document.getElementById('teacherProfileName')
  const profileEmail = document.getElementById('teacherProfileEmail')
  if (profileName) profileName.value = profile.name || ''
  if (profileEmail) profileEmail.value = profile.email || ''

  return profile
}

async function fetchTeacherSchedules() {
  if (!state.teacher) return []

  const { data, error } = await supabase
    .from('schedules')
    .select(`
      id,
      day,
      start_time,
      end_time,
      room,
      teacher_id,
      section_id,
      subject_id,
      subject,
      sections:section_id (id, name),
      subjects:subject_id (id, name, code)
    `)
    .eq('teacher_id', state.teacher.id)
    .order('day', { ascending: true })

  if (error) {
    console.error('Teacher schedules error:', error)
    return []
  }

  return data || []
}

async function fetchTeacherStudents(sectionIds = []) {
  if (!sectionIds.length) return []

  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, student_id, section_id, grade_level')
    .eq('role', 'STUDENT')
    .in('section_id', sectionIds)
    .order('name', { ascending: true })

  if (error) {
    console.error('Teacher student list error:', error)
    return []
  }

  return data || []
}

async function fetchTeacherAttendance(studentIds = []) {
  if (!studentIds.length) return []

  const { data, error } = await supabase
    .from('attendance')
    .select('id, student_id, attendance_date, time_in, status, schedule_id')
    .in('student_id', studentIds)
    .order('attendance_date', { ascending: false })

  if (error) {
    console.error('Teacher attendance error:', error)
    return []
  }

  return data || []
}

async function fetchTeacherGrades(studentIds = []) {
  if (!studentIds.length) return []

  const { data, error } = await supabase
    .from('grades')
    .select('id, student_id, teacher_id, subject_id, subject, quarter, score, remarks, created_at')
    .eq('teacher_id', state.teacher.id)
    .in('student_id', studentIds)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Teacher grades error:', error)
    return []
  }

  return data || []
}

function buildSubjectOptions() {
  const allSubjects = [...new Map(state.schedules.map(schedule => {
    const subjectName = schedule.subject || schedule.subjects?.name || 'Unknown Subject'
    const subjectId = schedule.subject_id || subjectName
    return [String(subjectId), { id: String(subjectId), name: subjectName }]
  })).values()]

  return allSubjects
}

function buildSectionOptionsForSubject(subjectId = '') {
  const schedules = subjectId
    ? state.schedules.filter(schedule => {
        const subjectKey = scheduleMatchKey(schedule)
        return String(subjectKey) === String(subjectId) || normalizeText(schedule.subject || schedule.subjects?.name || '') === normalizeText(String(subjectId))
      })
    : state.schedules

  const sectionIds = [...new Set(schedules.map(schedule => schedule.section_id).filter(Boolean))]
  return sectionIds.map(sectionId => ({ id: sectionId, name: inferSectionLabel(sectionId) }))
}

function populateTeacherFilters() {
  const subjectFilter = document.getElementById('teacherAttendanceSubjectFilter')
  const sectionFilter = document.getElementById('teacherAttendanceSectionFilter')
  const gradeSubject = document.getElementById('teacherGradeSubject')
  const gradeSection = document.getElementById('teacherGradeSection')

  const allSubjects = buildSubjectOptions()
  const sectionKeys = [...new Set([
    ...state.schedules.map(schedule => schedule.section_id).filter(Boolean),
    ...state.students.map(student => student.section_id).filter(Boolean),
    ...state.sections.map(section => section.id).filter(Boolean)
  ])]

  const allSections = sectionKeys.map(sectionId => ({
    id: sectionId,
    name: inferSectionLabel(sectionId)
  }))

  if (subjectFilter) {
    subjectFilter.innerHTML = '<option value="">All Subjects</option>' + allSubjects.map(subject => `<option value="${subject.id}">${subject.name}</option>`).join('')
  }

  if (sectionFilter) {
    sectionFilter.innerHTML = '<option value="">All Sections</option>' + allSections.map(section => `<option value="${section.id}">${section.name}</option>`).join('')
  }

  if (gradeSubject) {
    const currentValue = gradeSubject.value || ''
    gradeSubject.innerHTML = '<option value="">Select subject</option>' + allSubjects.map(subject => `<option value="${subject.id}">${subject.name}</option>`).join('')
    if (currentValue) {
      gradeSubject.value = allSubjects.some(subject => String(subject.id) === String(currentValue)) ? currentValue : ''
    }
  }

  if (gradeSection) {
    const selectedSubject = gradeSubject?.value || ''
    const filteredSections = buildSectionOptionsForSubject(selectedSubject)
    gradeSection.innerHTML = '<option value="">Select section</option>' + filteredSections.map(section => `<option value="${section.id}">${section.name}</option>`).join('')
    if (!selectedSubject) {
      gradeSection.innerHTML = '<option value="">Select subject first</option>'
    }
  }
}

function getScheduleMatchesForStudent(student) {
  if (!student) return []
  return state.schedules.filter(schedule => {
    const sameSection = String(schedule.section_id || '') === String(student.section_id || '')
    const sameSubject = schedule.subject && student.subject ? normalizeText(schedule.subject) === normalizeText(student.subject) : true
    return sameSection || sameSubject
  })
}

function renderOverview() {
  const subjectNames = [...new Set(state.schedules.map(schedule => schedule.subject || schedule.subjects?.name || 'Unknown Subject').filter(Boolean))]
  const sectionNames = [...new Set(state.schedules.map(schedule => schedule.sections?.name || 'Unknown Section').filter(Boolean))]
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long' })
  const todaysSchedules = state.schedules.filter(schedule => schedule.day === today).length

  setText('teacherAssignedSubjects', subjectNames.length)
  setText('teacherAssignedSections', sectionNames.length)
  setText('teacherStudentCount', state.students.length)
  setText('teacherTodaySchedules', todaysSchedules)
  setText('teacherNameValue', state.teacher.name || 'Teacher')
  setText('teacherSubjectList', subjectNames.length ? subjectNames.join(', ') : 'No assigned subjects')

  const attendanceRows = state.attendance.filter(row => {
    const date = row.attendance_date || ''
    return date === new Date().toISOString().slice(0, 10)
  })

  const present = attendanceRows.filter(row => normalizeText(row.status) === 'present').length
  const late = attendanceRows.filter(row => normalizeText(row.status) === 'late').length
  const absent = attendanceRows.filter(row => normalizeText(row.status) === 'absent').length
  setText('teacherAttendanceSummary', `${present} present / ${absent} absent`)

  const pending = state.grades.filter(row => Number(row.score || 0) < 75 && row.score !== null).length
  setText('teacherPendingGrades', pending ? `${pending} grade entries need attention` : 'No pending grades')
}

function renderTeacherSchedule() {
  const tbody = document.getElementById('teacherScheduleTableBody')
  const paginationContainer = document.getElementById('teacherSchedulePagination')
  if (!tbody) return

  if (!state.schedules.length) {
    tbody.innerHTML = '<tr><td colspan="6">No schedules assigned to this teacher.</td></tr>'
    if (paginationContainer) paginationContainer.innerHTML = ''
    return
  }

  const totalPages = Math.max(1, Math.ceil(state.schedules.length / state.rowsPerPage))
  state.schedulePage = Math.min(state.schedulePage, totalPages)

  const startIndex = (state.schedulePage - 1) * state.rowsPerPage
  const pageItems = state.schedules.slice(startIndex, startIndex + state.rowsPerPage)

  tbody.innerHTML = pageItems.map(schedule => {
    const sectionName = schedule.sections?.name || '—'
    const subjectName = schedule.subject || schedule.subjects?.name || '—'
    const studentCount = state.students.filter(student => String(student.section_id) === String(schedule.section_id)).length

    return `
      <tr>
        <td>${subjectName}</td>
        <td>${sectionName}</td>
        <td>${schedule.day || '—'}</td>
        <td>${schedule.start_time || '—'} - ${schedule.end_time || '—'}</td>
        <td>${schedule.room || '—'}</td>
        <td>${studentCount}</td>
      </tr>
    `
  }).join('')

  renderPagination('teacherSchedulePagination', state.schedulePage, totalPages, (page) => {
    state.schedulePage = page
    renderTeacherSchedule()
  })
}

function renderTeacherAttendance() {
  const tbody = document.getElementById('teacherAttendanceTableBody')
  const paginationContainer = document.getElementById('teacherAttendancePagination')
  const subjectFilter = document.getElementById('teacherAttendanceSubjectFilter')?.value || ''
  const sectionFilter = document.getElementById('teacherAttendanceSectionFilter')?.value || ''
  const dateFilter = document.getElementById('teacherAttendanceDateFilter')?.value || ''

  if (!tbody) return

  const filtered = state.attendance.filter(row => {
    const student = byId(state.students, row.student_id)
    const schedule = state.schedules.find(item => String(item.section_id) === String(student?.section_id || ''))
    const matchesSubject = !subjectFilter || String(schedule?.subject_id || schedule?.subject || '') === String(subjectFilter) || String(schedule?.subjects?.id || '') === String(subjectFilter)
    const matchesSection = !sectionFilter || String(student?.section_id || '') === String(sectionFilter) || String(schedule?.section_id || '') === String(sectionFilter)
    const matchesDate = !dateFilter || (row.attendance_date || '').startsWith(dateFilter)
    return matchesSubject && matchesSection && matchesDate
  })

  const totalPages = Math.max(1, Math.ceil(filtered.length / state.rowsPerPage))
  state.attendancePage = Math.min(state.attendancePage, totalPages)

  const startIndex = (state.attendancePage - 1) * state.rowsPerPage
  const pageItems = filtered.slice(startIndex, startIndex + state.rowsPerPage)

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="5">No attendance records found for your assigned schedules.</td></tr>'
    if (paginationContainer) paginationContainer.innerHTML = ''
    return
  }

  tbody.innerHTML = pageItems.map(row => {
    const student = byId(state.students, row.student_id)
    const status = (row.status || 'present').toString().charAt(0).toUpperCase() + (row.status || 'present').toString().slice(1)
    return `
      <tr>
        <td>${student?.name || 'Unknown Student'}</td>
        <td>${row.attendance_date || '—'}</td>
        <td>${row.time_in || '—'}</td>
        <td><span class="pill ${row.status === 'present' ? 'pill-green' : row.status === 'late' ? 'pill-yellow' : 'pill-red'}">${status}</span></td>
      </tr>
    `
  }).join('')

  renderPagination('teacherAttendancePagination', state.attendancePage, totalPages, (page) => {
    state.attendancePage = page
    renderTeacherAttendance()
  })
}

function populateGradeStudentList() {
  const subjectId = document.getElementById('teacherGradeSubject')?.value || ''
  const sectionId = document.getElementById('teacherGradeSection')?.value || ''
  const studentSelect = document.getElementById('teacherGradeStudent')
  if (!studentSelect) return

  const eligibleSchedules = state.schedules.filter(schedule => {
    const subjectMatches = !subjectId || String(scheduleMatchKey(schedule)) === String(subjectId) || normalizeText(schedule.subject || schedule.subjects?.name || '') === normalizeText(String(subjectId))
    const sectionMatches = !sectionId || String(schedule.section_id) === String(sectionId)
    return subjectMatches && sectionMatches
  })

  const eligibleSectionIds = [...new Set(eligibleSchedules.map(schedule => schedule.section_id).filter(Boolean))]

  const allowedStudents = state.students.filter(student => {
    const sectionMatches = !sectionId || String(student.section_id) === String(sectionId)
    const subjectMatches = !subjectId || eligibleSectionIds.includes(student.section_id)
    return sectionMatches && subjectMatches && eligibleSectionIds.includes(student.section_id)
  })

  studentSelect.innerHTML = '<option value="">Select student</option>' + allowedStudents.map(student => `<option value="${student.id}">${student.name} (${student.student_id || 'No ID'})</option>`).join('')
}

function renderTeacherGradesTable() {
  const tbody = document.getElementById('teacherGradeTableBody')
  const paginationContainer = document.getElementById('teacherGradesPagination')
  if (!tbody) return

  if (!state.grades.length) {
    tbody.innerHTML = '<tr><td colspan="6">No grade entries found for your classes yet.</td></tr>'
    if (paginationContainer) paginationContainer.innerHTML = ''
    return
  }

  const totalPages = Math.max(1, Math.ceil(state.grades.length / state.rowsPerPage))
  state.gradesPage = Math.min(state.gradesPage, totalPages)

  const startIndex = (state.gradesPage - 1) * state.rowsPerPage
  const pageItems = state.grades.slice(startIndex, startIndex + state.rowsPerPage)

  tbody.innerHTML = pageItems.map(grade => {
    const student = byId(state.students, grade.student_id)
    const scheduleMatch = state.schedules.find(schedule =>
      String(schedule.section_id) === String(student?.section_id || '') && (
        String(schedule.subject_id || schedule.subject || '') === String(grade.subject_id || grade.subject || '') ||
        normalizeText(schedule.subject || schedule.subjects?.name || '') === normalizeText(grade.subject || '')
      )
    )
    const subjectName = grade.subject || scheduleMatch?.subject || scheduleMatch?.subjects?.name || '—'
    const sectionName = getSectionLabel(student?.section_id || scheduleMatch?.section_id || '')

    return `
      <tr>
        <td>${student?.name || 'Unknown Student'}</td>
        <td>${subjectName}</td>
        <td>${sectionName}</td>
        <td>${grade.quarter || '—'}</td>
        <td>${grade.score ?? '—'}</td>
        <td>${grade.remarks || '—'}</td>
      </tr>
    `
  }).join('')

  renderPagination('teacherGradesPagination', state.gradesPage, totalPages, (page) => {
    state.gradesPage = page
    renderTeacherGradesTable()
  })
}

async function refreshTeacherDashboard() {
  const sectionIds = [...new Set(state.schedules.map(schedule => schedule.section_id).filter(Boolean))]
  const studentIds = [...new Set(state.students.map(student => student.id).filter(Boolean))]

  state.students = await fetchTeacherStudents(sectionIds)
  state.attendance = await fetchTeacherAttendance(studentIds)
  state.grades = await fetchTeacherGrades(studentIds)

  renderOverview()
  renderTeacherSchedule()
  renderTeacherAttendance()
  renderTeacherGradesTable()
  populateTeacherFilters()
  populateGradeStudentList()
}

function scheduleMatchKey(schedule) {
  return schedule.subject_id || schedule.subject || schedule.subjects?.name || schedule.subjects?.id || 'unknown-subject'
}

async function initTeacherDashboard() {
  const profile = await loadTeacherProfile()
  if (!profile) return

  const schedules = await fetchTeacherSchedules()
  state.schedules = schedules
  const sectionIds = [...new Set(schedules.map(schedule => schedule.section_id).filter(Boolean))]
  if (sectionIds.length) {
    const { data: sections, error } = await supabase.from('sections').select('id,name,grade_level').in('id', sectionIds)
    state.sections = !error && Array.isArray(sections) && sections.length ? sections : sectionIds.map(sectionId => ({
      id: sectionId,
      name: inferSectionLabel(sectionId),
      grade_level: null
    }))
  } else {
    state.sections = []
  }

  const subjectIds = [...new Set(schedules.map(schedule => schedule.subject_id).filter(Boolean))]
  if (subjectIds.length) {
    const { data: subjects } = await supabase.from('subjects').select('id,name,grade_level').in('id', subjectIds)
    state.subjects = subjects || []
  } else {
    state.subjects = []
  }

  state.students = await fetchTeacherStudents(sectionIds)
  const studentIds = state.students.map(student => student.id)
  state.attendance = await fetchTeacherAttendance(studentIds)
  state.grades = await fetchTeacherGrades(studentIds)

  populateTeacherFilters()
  renderOverview()
  renderTeacherSchedule()
  renderTeacherAttendance()
  renderTeacherGradesTable()
  populateGradeStudentList()

  document.getElementById('teacherAttendanceSubjectFilter')?.addEventListener('change', () => {
    state.attendancePage = 1
    renderTeacherAttendance()
  })
  document.getElementById('teacherAttendanceSectionFilter')?.addEventListener('change', () => {
    state.attendancePage = 1
    renderTeacherAttendance()
  })
  document.getElementById('teacherAttendanceDateFilter')?.addEventListener('change', () => {
    state.attendancePage = 1
    renderTeacherAttendance()
  })
  document.getElementById('teacherGradeSubject')?.addEventListener('change', () => {
    populateTeacherFilters()
    populateGradeStudentList()
  })
  document.getElementById('teacherGradeSection')?.addEventListener('change', populateGradeStudentList)

  document.getElementById('teacherGradeForm')?.addEventListener('submit', async (event) => {
    event.preventDefault()

    const subjectId = document.getElementById('teacherGradeSubject')?.value || ''
    const sectionId = document.getElementById('teacherGradeSection')?.value || ''
    const quarter = document.getElementById('teacherGradeQuarter')?.value || ''
    const studentId = document.getElementById('teacherGradeStudent')?.value || ''
    const score = Number(document.getElementById('teacherGradeScore')?.value || 0)
    const remarks = document.getElementById('teacherGradeRemarks')?.value.trim() || null

    if (!subjectId || !sectionId || !quarter || !studentId) {
      showToast('Missing fields', 'Select a subject, section, quarter, and student.', 'warning')
      return
    }

    if (Number.isNaN(score) || score < 0 || score > 100) {
      showToast('Invalid grade', 'Grade must be between 0 and 100.', 'warning')
      return
    }

    const student = byId(state.students, studentId)
    const schedule = state.schedules.find(item =>
      String(item.section_id) === String(sectionId) &&
      (
        String(scheduleMatchKey(item)) === String(subjectId) ||
        normalizeText(item.subject || item.subjects?.name || '') === normalizeText(String(subjectId))
      )
    )

    if (!student || !schedule || String(student.section_id) !== String(sectionId)) {
      showToast('Access denied', 'You can only enter grades for students in your assigned schedules.', 'error')
      return
    }

    const subjectName = schedule.subject || schedule.subjects?.name || 'Unknown Subject'
    const payload = {
      student_id: studentId,
      teacher_id: state.teacher.id,
      subject: subjectName,
      subject_id: schedule.subject_id || null,
      quarter,
      score,
      remarks
    }

    const { error } = await supabase.from('grades').insert([payload])
    if (error) {
      console.error('Grade insert failed:', error)
      showToast('Save failed', error.message || 'Could not save the grade record.', 'error')
      return
    }

    showToast('Grade saved', 'The grade entry was saved successfully.', 'success')
    document.getElementById('teacherGradeForm').reset()
    const freshGrades = await fetchTeacherGrades(state.students.map(student => student.id))
    state.grades = freshGrades
    renderTeacherGradesTable()
    renderOverview()
  })
}

document.addEventListener('DOMContentLoaded', () => {
  if (window.showToast) {
    window.logout = logout
  }

  setupNavigation()
  initTeacherDashboard()
})

window.logout = logout
window.renderTeacherAttendance = renderTeacherAttendance
window.populateGradeStudentList = populateGradeStudentList
