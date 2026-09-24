import { supabase } from '../services/supabaseClient.js'
import { showToast } from '../ui/toast.js'

let allSchedules = []
let allTeachers = []
let allSections = []
let allSubjects = []
let currentPage = 1
const PER_PAGE = 10
const DAY_OPTIONS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const ALLOWED_START_MINUTES = 7 * 60
const ALLOWED_END_MINUTES = 18 * 60

const val = id => (document.getElementById(id)?.value ?? '').trim()
const openM = id => document.getElementById(id)?.classList.remove('hidden')
const closeM = id => document.getElementById(id)?.classList.add('hidden')

function normalizeDay(value) {
  return String(value ?? '').trim().toLowerCase()
}

function normalizeTime(value) {
  if (!value) return ''
  const raw = String(value).trim()
  const match = raw.match(/^\d{1,2}:\d{2}(?::\d{2})?$/)
  if (!match) return raw
  const [hours, minutes] = raw.split(':').map(Number)
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return raw
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function timeToMinutes(value) {
  const normalized = normalizeTime(value)
  if (!normalized) return null
  const [hours, minutes] = normalized.split(':').map(Number)
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null
  return (hours * 60) + minutes
}

function overlaps(startA, endA, startB, endB) {
  return Math.max(startA, startB) < Math.min(endA, endB)
}

function getTeacherName(teacherId) {
  const teacher = allTeachers.find(row => String(row.id) === String(teacherId))
  return teacher?.name || 'Unassigned'
}

function getSectionName(sectionId) {
  const section = allSections.find(row => String(row.id) === String(sectionId))
  return section?.name || '—'
}

function getSubjectName(schedule) {
  if (schedule?.subject_name) return schedule.subject_name
  if (schedule?.subject) return schedule.subject
  if (schedule?.subject_id) {
    const subject = allSubjects.find(row => String(row.id) === String(schedule.subject_id))
    return subject?.name || subject?.subject_name || subject?.code || '—'
  }
  return '—'
}

function getSubjectOptions() {
  const fallbackSubjects = [
    'Mathematics',
    'Science',
    'English',
    'Filipino',
    'History',
    'MAPEH',
    'Values Education',
    'Technology',
    'Computer',
    'Arts'
  ]

  const uniqueSubjects = [...new Set([
    ...allSubjects.map(subject => String(subject.name || subject.subject_name || subject.code || '')).filter(Boolean),
    ...fallbackSubjects
  ])]

  return uniqueSubjects
}

function getRoomOptions() {
  const existing = allSchedules
    .map(schedule => schedule.room)
    .filter(Boolean)
    .map(room => String(room).trim())

  const defaults = ['Room 101', 'Room 102', 'Room 103', 'Room 104', 'Room 201', 'Room 202', 'Room 301', 'Science Lab', 'Computer Lab']
  return [...new Set([...defaults, ...existing])].sort()
}

function populateScheduleSelects() {
  const teacherOptions = ['<option value="">Select teacher…</option>']
    .concat(allTeachers.map(teacher => `<option value="${teacher.id}">${teacher.name} ${teacher.teacher_id ? `(${teacher.teacher_id})` : ''}</option>`))
    .join('')

  const sectionOptions = ['<option value="">Select section…</option>']
    .concat(allSections.map(section => `<option value="${section.id}">${section.name}</option>`))
    .join('')

  document.querySelectorAll('[data-schedule-teacher]').forEach(el => {
    el.innerHTML = teacherOptions
  })
  document.querySelectorAll('[data-schedule-section]').forEach(el => {
    el.innerHTML = sectionOptions
  })

  const roomOptions = getRoomOptions().map(room => `<option value="${room}"></option>`).join('')
  const roomList = document.getElementById('scheduleRoomList')
  if (roomList) roomList.innerHTML = roomOptions

  document.querySelectorAll('[data-schedule-subject]').forEach((el) => {
    el.innerHTML = '<option value="">Select a section first</option>'
    el.disabled = true
  })

  const addSection = document.getElementById('scheduleSection')
  if (addSection && addSection.value) {
    refreshSubjectOptionsForSection(addSection.value, 'scheduleSubject')
  }

  const editSection = document.getElementById('editScheduleSection')
  if (editSection && editSection.value) {
    refreshSubjectOptionsForSection(editSection.value, 'editScheduleSubject')
  }
}

function getSectionGradeLevel(sectionId) {
  const section = allSections.find(row => String(row.id) === String(sectionId))
  const gradeLevel = section?.grade_level ?? section?.gradeLevel ?? section?.level
  return gradeLevel !== undefined && gradeLevel !== null && gradeLevel !== '' ? Number(gradeLevel) : null
}

function refreshSubjectOptionsForSection(sectionId, fieldId) {
  const subjectSelect = document.getElementById(fieldId)
  if (!subjectSelect) return

  const sectionGradeLevel = getSectionGradeLevel(sectionId)
  const filteredSubjects = sectionGradeLevel === null
    ? []
    : allSubjects.filter(subject => {
        const subjectGrade = subject?.grade_level ?? subject?.gradeLevel ?? subject?.level
        return Number(subjectGrade) === Number(sectionGradeLevel)
      })

  if (!sectionId) {
    subjectSelect.innerHTML = '<option value="">Select a section first</option>'
    subjectSelect.disabled = true
    subjectSelect.value = ''
    return
  }

  if (!filteredSubjects.length) {
    subjectSelect.innerHTML = '<option value="">No subjects for this grade level</option>'
    subjectSelect.disabled = true
    subjectSelect.value = ''
    return
  }

  subjectSelect.innerHTML = ['<option value="">Select subject…</option>']
    .concat(filteredSubjects.map(subject => {
      const label = subject.name || subject.subject_name || subject.code || 'Unnamed Subject'
      return `<option value="${subject.id}">${label}</option>`
    }))
    .join('')

  subjectSelect.disabled = false

  const currentValue = subjectSelect.dataset.selectedValue
  if (currentValue) {
    subjectSelect.value = filteredSubjects.some(subject => String(subject.id) === String(currentValue)) ? currentValue : ''
    delete subjectSelect.dataset.selectedValue
  } else {
    subjectSelect.value = ''
  }
}

function bindSectionSubjectFilters() {
  const addSectionSelect = document.getElementById('scheduleSection')
  const editSectionSelect = document.getElementById('editScheduleSection')

  const refreshAdd = () => {
    refreshSubjectOptionsForSection(addSectionSelect?.value || '', 'scheduleSubject')
  }
  const refreshEdit = () => {
    refreshSubjectOptionsForSection(editSectionSelect?.value || '', 'editScheduleSubject')
  }

  if (addSectionSelect) {
    addSectionSelect.onchange = () => {
      const subjectSelect = document.getElementById('scheduleSubject')
      if (subjectSelect) subjectSelect.value = ''
      refreshAdd()
    }
  }

  if (editSectionSelect) {
    editSectionSelect.onchange = () => {
      const subjectSelect = document.getElementById('editScheduleSubject')
      if (subjectSelect) subjectSelect.value = ''
      refreshEdit()
    }
  }
}

function renderScheduleRows(list) {
  const tbody = document.getElementById('schedulesTableBody')
  const countEl = document.getElementById('schedulesCount')
  if (!tbody) return

  if (!list.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8">
          <div class="empty-state">
            <div class="empty-icon">📅</div>
            <div class="empty-title">No schedules found</div>
            <div class="empty-sub">Create a class schedule to begin planning the timetable.</div>
          </div>
        </td>
      </tr>
    `
    if (countEl) countEl.textContent = '0 schedules'
    const paginationEl = document.getElementById('schedulesPagination')
    if (paginationEl) paginationEl.innerHTML = ''
    return
  }

  const start = (currentPage - 1) * PER_PAGE
  const slice = list.slice(start, start + PER_PAGE)
  const pages = Math.ceil(list.length / PER_PAGE)

  tbody.innerHTML = slice.map(schedule => {
    const subjectName = getSubjectName(schedule)
    const teacherName = getTeacherName(schedule.teacher_id)
    const sectionName = getSectionName(schedule.section_id)

    const deleteLabel = (schedule.day || 'schedule').replace(/'/g, "\\'")

    return `
      <tr>
        <td>${schedule.day || '—'}</td>
        <td>${schedule.start_time ? normalizeTime(schedule.start_time) : '—'} – ${schedule.end_time ? normalizeTime(schedule.end_time) : '—'}</td>
        <td>${schedule.room || '—'}</td>
        <td>${teacherName}</td>
        <td>${sectionName}</td>
        <td>${subjectName}</td>
        <td>
          <div class="row-acts">
            <button class="act-btn" title="Edit" onclick="openEditScheduleModal('${schedule.id}')">✏️</button>
            <button class="act-btn danger" title="Delete" onclick="confirmDeleteSchedule('${schedule.id}','${deleteLabel}')">🗑</button>
          </div>
        </td>
      </tr>
    `
  }).join('')

  if (countEl) {
    countEl.textContent = `Showing ${start + 1}–${Math.min(start + PER_PAGE, list.length)} of ${list.length} schedules`
  }

  const paginationEl = document.getElementById('schedulesPagination')
  if (paginationEl) {
    paginationEl.innerHTML = Array.from({ length: pages }, (_, index) => {
      const pageNumber = index + 1
      const active = currentPage === pageNumber ? 'active' : ''
      return `<button class="page-btn ${active}" type="button" data-page="${pageNumber}">${pageNumber}</button>`
    }).join('')

    paginationEl.querySelectorAll('.page-btn').forEach(button => {
      button.addEventListener('click', () => {
        currentPage = Number(button.dataset.page || 1)
        renderScheduleRows(list)
      })
    })
  }
}

export async function loadScheduleManagement() {
  const tbody = document.getElementById('schedulesTableBody')
  if (tbody) tbody.innerHTML = `<tr><td colspan="8"><div class="loader"><div class="spinner"></div></div></td></tr>`

  const [teacherResult, sectionResult, subjectResult, scheduleResult] = await Promise.all([
    supabase.from('profiles').select('id,name,teacher_id').eq('role', 'TEACHER').order('name', { ascending: true }),
    supabase.from('sections').select('id,name,grade_level').order('name', { ascending: true }),
    supabase.from('subjects').select('*').order('name', { ascending: true }),
    supabase.from('schedules').select('*').order('day', { ascending: true })
  ])

  if (!teacherResult.error) allTeachers = teacherResult.data || []
  if (!sectionResult.error) allSections = sectionResult.data || []
  if (!subjectResult.error) allSubjects = subjectResult.data || []

  if (scheduleResult.error) {
    console.error('Schedule management load error:', scheduleResult.error)
    allSchedules = []
    showToast('Schedule unavailable', scheduleResult.error.message || 'Unable to load the schedule list.', 'error')
  } else {
    allSchedules = (scheduleResult.data || []).sort((left, right) => {
      const dayIndex = DAY_OPTIONS.indexOf(left.day || 'Monday')
      const secondDayIndex = DAY_OPTIONS.indexOf(right.day || 'Monday')
      const startA = timeToMinutes(left.start_time) ?? 0
      const startB = timeToMinutes(right.start_time) ?? 0
      return dayIndex - secondDayIndex || startA - startB
    })
  }

  populateScheduleSelects()
  currentPage = 1
  renderScheduleRows(allSchedules)
}

function validateScheduleRecord(record, existingRows = allSchedules, ignoreId = '') {
  if (!record.day || !record.start_time || !record.end_time || !record.room || !record.teacher_id || !record.section_id || (!record.subject_id && !record.subject_name)) {
    return { valid: false, message: 'All required fields must be completed.' }
  }

  const sectionGrade = getSectionGradeLevel(record.section_id)
  const selectedSubject = allSubjects.find(subject => String(subject.id) === String(record.subject_id || '')) || allSubjects.find(subject => String(subject.name || subject.subject_name || subject.code) === String(record.subject_name || ''))
  const subjectGrade = selectedSubject ? Number(selectedSubject.grade_level ?? selectedSubject.gradeLevel ?? selectedSubject.level ?? -1) : null

  if (sectionGrade !== null && subjectGrade !== null && Number(subjectGrade) !== Number(sectionGrade)) {
    return { valid: false, message: 'Schedule validation: The selected subject does not match the selected section grade level.' }
  }

  const startMinutes = timeToMinutes(record.start_time)
  const endMinutes = timeToMinutes(record.end_time)

  if (startMinutes === null || endMinutes === null || startMinutes >= endMinutes) {
    return { valid: false, message: 'Start time must be earlier than the end time.' }
  }

  if (startMinutes < ALLOWED_START_MINUTES || endMinutes > ALLOWED_END_MINUTES) {
    return { valid: false, message: 'The schedule must be within the allowed time range of 7:00 AM to 6:00 PM.' }
  }

  const exactDuplicate = existingRows.some(row => {
    if (String(row.id) === String(ignoreId)) return false
    const sameDay = normalizeDay(row.day) === normalizeDay(record.day)
    const sameStart = normalizeTime(row.start_time) === normalizeTime(record.start_time)
    const sameEnd = normalizeTime(row.end_time) === normalizeTime(record.end_time)
    const sameRoom = String(row.room || '').trim().toLowerCase() === String(record.room).trim().toLowerCase()
    const sameTeacher = String(row.teacher_id || '') === String(record.teacher_id)
    const sameSection = String(row.section_id || '') === String(record.section_id)
    const sameSubject = String(row.subject_id || row.subject_name || row.subject || '') === String(record.subject_id || record.subject_name || record.subject || '')
    return sameDay && sameStart && sameEnd && sameRoom && sameTeacher && sameSection && sameSubject
  })

  if (exactDuplicate) {
    return { valid: false, message: 'Exact duplicate schedules are not allowed.' }
  }

  const teacherMatches = existingRows.filter(row => {
    if (String(row.id) === String(ignoreId)) return false
    return String(row.teacher_id || '').toLowerCase() === String(record.teacher_id || '').toLowerCase() && normalizeDay(row.day) === normalizeDay(record.day)
  })

  const teacherConflict = teacherMatches.some(row => {
    const rowStart = timeToMinutes(row.start_time)
    const rowEnd = timeToMinutes(row.end_time)
    if (rowStart === null || rowEnd === null) return false
    return overlaps(startMinutes, endMinutes, rowStart, rowEnd)
  })

  if (teacherConflict) {
    return { valid: false, message: 'Schedule Conflict: This teacher is already assigned to another class during this time.' }
  }

  const sectionMatches = existingRows.filter(row => {
    if (String(row.id) === String(ignoreId)) return false
    return String(row.section_id || '').toLowerCase() === String(record.section_id || '').toLowerCase() && normalizeDay(row.day) === normalizeDay(record.day)
  })

  const sectionConflict = sectionMatches.some(row => {
    const rowStart = timeToMinutes(row.start_time)
    const rowEnd = timeToMinutes(row.end_time)
    if (rowStart === null || rowEnd === null) return false
    return overlaps(startMinutes, endMinutes, rowStart, rowEnd)
  })

  if (sectionConflict) {
    return { valid: false, message: 'Schedule Conflict: This section already has another subject scheduled during this time.' }
  }

  const roomMatches = existingRows.filter(row => {
    if (String(row.id) === String(ignoreId)) return false
    return String(row.room || '').trim().toLowerCase() === String(record.room).trim().toLowerCase() && normalizeDay(row.day) === normalizeDay(record.day)
  })

  const roomConflict = roomMatches.some(row => {
    const rowStart = timeToMinutes(row.start_time)
    const rowEnd = timeToMinutes(row.end_time)
    if (rowStart === null || rowEnd === null) return false
    return overlaps(startMinutes, endMinutes, rowStart, rowEnd)
  })

  if (roomConflict) {
    return { valid: false, message: 'Schedule Conflict: This room is already assigned to another class during this time.' }
  }

  return { valid: true }
}

async function submitScheduleForm({ editing = false } = {}) {
  const formId = editing ? 'editScheduleForm' : 'addScheduleForm'
  const scheduleId = editing ? val('editScheduleId') : ''
  const subjectValue = val(editing ? 'editScheduleSubject' : 'scheduleSubject')
  const matchedSubject = allSubjects.find(subject => String(subject.id) === String(subjectValue))
  const subjectText = matchedSubject ? (matchedSubject.name || matchedSubject.subject_name || matchedSubject.code || '') : (subjectValue || '')

  const record = {
    day: val(editing ? 'editScheduleDay' : 'scheduleDay'),
    start_time: normalizeTime(val(editing ? 'editScheduleStartTime' : 'scheduleStartTime')),
    end_time: normalizeTime(val(editing ? 'editScheduleEndTime' : 'scheduleEndTime')),
    room: val(editing ? 'editScheduleRoom' : 'scheduleRoom'),
    teacher_id: val(editing ? 'editScheduleTeacher' : 'scheduleTeacher'),
    section_id: val(editing ? 'editScheduleSection' : 'scheduleSection'),
    subject_id: matchedSubject ? matchedSubject.id : null,
    subject: subjectText || null,
  }

  const validation = validateScheduleRecord(record, allSchedules, scheduleId)
  if (!validation.valid) {
    showToast('Schedule validation', validation.message, 'warning')
    return
  }

  try {
    const payload = {
      day: record.day,
      start_time: record.start_time,
      end_time: record.end_time,
      room: record.room,
      teacher_id: record.teacher_id || null,
      section_id: record.section_id || null,
      subject_id: record.subject_id || null,
      subject: record.subject || null,
    }

    const { error } = editing
      ? await supabase.from('schedules').update(payload).eq('id', scheduleId)
      : await supabase.from('schedules').insert([payload])

    if (error) throw error

    showToast(editing ? 'Schedule updated' : 'Schedule added', editing ? 'The schedule was updated successfully.' : 'New schedule saved successfully.', 'success')

    closeM(editing ? 'editScheduleModal' : 'addScheduleModal')
    if (document.getElementById(formId)) document.getElementById(formId).reset()
    await loadScheduleManagement()
  } catch (error) {
    showToast('Schedule save failed', error.message || 'Could not save the schedule.', 'error')
  }
}

export async function submitAddSchedule() {
  await submitScheduleForm({ editing: false })
}

export async function openEditScheduleModal(id) {
  const { data, error } = await supabase.from('schedules').select('*').eq('id', id).single()
  if (error) {
    showToast('Error', 'Could not load schedule details.', 'error')
    return
  }

  const roomSelect = document.getElementById('editScheduleRoom')
  if (roomSelect) roomSelect.value = data.room || ''
  document.getElementById('editScheduleId').value = data.id || ''
  document.getElementById('editScheduleDay').value = data.day || 'Monday'
  document.getElementById('editScheduleStartTime').value = normalizeTime(data.start_time || '')
  document.getElementById('editScheduleEndTime').value = normalizeTime(data.end_time || '')
  document.getElementById('editScheduleTeacher').value = data.teacher_id || ''
  document.getElementById('editScheduleSection').value = data.section_id || ''

  const subjectValue = data.subject_id
    || allSubjects.find(subject => String(subject.name || subject.subject_name || subject.code) === String(data.subject_name || ''))?.id
    || data.subject_name
    || ''

  const subjectInput = document.getElementById('editScheduleSubject')
  if (subjectInput) {
    subjectInput.dataset.selectedValue = String(subjectValue || '')
    refreshSubjectOptionsForSection(data.section_id || '', 'editScheduleSubject')
    if (subjectValue) {
      const selectedSubject = allSubjects.find(subject => String(subject.id) === String(subjectValue))
      if (selectedSubject && String(selectedSubject.id) === String(subjectValue)) {
        subjectInput.value = String(selectedSubject.id)
      } else {
        subjectInput.value = ''
      }
    }
  }

  openM('editScheduleModal')
}

export async function submitEditSchedule() {
  await submitScheduleForm({ editing: true })
}

window.confirmDeleteSchedule = async function(id, dayLabel) {
  if (!confirm(`Delete this ${dayLabel || 'schedule'} entry? This cannot be undone.`)) return

  try {
    const { error } = await supabase.from('schedules').delete().eq('id', id)
    if (error) throw error
    showToast('Schedule deleted', 'The schedule was removed successfully.', 'success')
    await loadScheduleManagement()
  } catch (error) {
    showToast('Delete failed', error.message || 'Could not delete the schedule.', 'error')
  }
}

export function initScheduleSection() {
  bindSectionSubjectFilters()

  document.getElementById('addScheduleBtn')?.addEventListener('click', () => {
    populateScheduleSelects()
    document.getElementById('addScheduleForm')?.reset()
    const subjectSelect = document.getElementById('scheduleSubject')
    if (subjectSelect) {
      subjectSelect.innerHTML = '<option value="">Select a section first</option>'
      subjectSelect.disabled = true
    }
    document.getElementById('scheduleDay')?.focus()
    openM('addScheduleModal')
  })

  document.getElementById('scheduleSearch')?.addEventListener('input', () => {
    const query = (document.getElementById('scheduleSearch')?.value || '').toLowerCase()
    const filtered = allSchedules.filter(schedule => {
      const room = String(schedule.room || '').toLowerCase()
      const teacher = getTeacherName(schedule.teacher_id).toLowerCase()
      const section = getSectionName(schedule.section_id).toLowerCase()
      const subject = getSubjectName(schedule).toLowerCase()
      return !query || room.includes(query) || teacher.includes(query) || section.includes(query) || subject.includes(query) || (schedule.day || '').toLowerCase().includes(query)
    })
    currentPage = 1
    renderScheduleRows(filtered)
  })

  loadScheduleManagement()
}

export function getScheduleManagementState() {
  return { schedules: allSchedules, teachers: allTeachers, sections: allSections, subjects: allSubjects }
}

window.submitAddSchedule = submitAddSchedule
window.openEditScheduleModal = openEditScheduleModal
window.submitEditSchedule = submitEditSchedule
