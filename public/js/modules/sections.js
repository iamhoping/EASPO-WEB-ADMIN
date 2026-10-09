import { supabase } from '../services/supabaseClient.js'
import { showToast } from '../ui/toast.js'
import { renderPagination } from '../ui/pagination.js'

const GRADE_LEVELS = [7, 8, 9, 10, 11, 12]
const PER_PAGE = 10

let sections = []
let visibleSections = []
let sectionStudentCounts = new Map()
let assignedStudents = []
let eligibleStudents = []
let selectedSection = null
let editingSectionId = null
let editingOriginalGrade = null
let currentPage = 1

const byId = id => document.getElementById(id)
const openSectionModal = () => byId('sectionModal')?.classList.remove('hidden')
const closeSectionModal = () => byId('sectionModal')?.classList.add('hidden')
const closeStudentModal = () => byId('addStudentToSectionModal')?.classList.add('hidden')
const gradeNumber = value => {
  const match = String(value ?? '').match(/\d+/)
  return match ? Number(match[0]) : NaN
}
const gradeLabel = value => Number.isFinite(gradeNumber(value)) ? `Grade ${gradeNumber(value)}` : '—'
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
})[character])

function filteredSectionRows() {
  const query = (byId('sectionSearch')?.value || '').trim().toLocaleLowerCase()
  const grade = byId('sectionGradeFilter')?.value || ''
  const selectedSection = byId('sectionFilter')?.value || ''
  return sections.filter(section =>
    (!query || String(section.name || '').toLocaleLowerCase().includes(query)) &&
    (!grade || String(gradeNumber(section.grade_level)) === grade) &&
    (!selectedSection || String(section.id) === selectedSection)
  )
}

function renderSections() {
  const tbody = byId('sectionsTableBody')
  const count = byId('sectionsCount')
  if (!tbody) return

  visibleSections = filteredSectionRows()
  if (!visibleSections.length) {
    tbody.innerHTML = '<tr><td colspan="4"><div class="empty-state"><div class="empty-title">No sections found</div><div class="empty-sub">Add a section or adjust your search and filters.</div></div></td></tr>'
    if (count) count.textContent = '0 sections'
    renderPagination('sectionsPagination', 1, 0, () => {})
    return
  }

  const totalPages = Math.ceil(visibleSections.length / PER_PAGE)
  currentPage = Math.min(currentPage, totalPages)
  const start = (currentPage - 1) * PER_PAGE
  const pageSections = visibleSections.slice(start, start + PER_PAGE)

  tbody.innerHTML = pageSections.map(section => `
    <tr>
      <td>${escapeHtml(section.name || '—')}</td>
      <td>${escapeHtml(gradeLabel(section.grade_level))}</td>
      <td>${sectionStudentCounts.has(String(section.id)) ? sectionStudentCounts.get(String(section.id)) : '—'}</td>
      <td>
        <div class="row-acts">
          <button class="act-btn" type="button" title="Edit" aria-label="Edit ${escapeHtml(section.name)}" data-section-action="edit" data-section-id="${escapeHtml(section.id)}">✏️</button>
          <button class="btn btn-secondary btn-sm" type="button" data-section-action="manage" data-section-id="${escapeHtml(section.id)}">Manage Students</button>
          <button class="act-btn danger" type="button" title="Delete" aria-label="Delete ${escapeHtml(section.name)}" data-section-action="delete" data-section-id="${escapeHtml(section.id)}">🗑</button>
        </div>
      </td>
    </tr>
  `).join('')

  if (count) count.textContent = `Showing ${start + 1}-${Math.min(start + PER_PAGE, visibleSections.length)} of ${visibleSections.length} sections`
  renderPagination('sectionsPagination', currentPage, totalPages, page => {
    currentPage = page
    renderSections()
  })
}

function populateSectionFilter() {
  const filter = byId('sectionFilter')
  if (!filter) return

  const selectedValue = filter.value
  filter.replaceChildren(new Option('All Sections', ''))
  for (const section of sections) {
    filter.add(new Option(section.name || 'Unnamed Section', String(section.id)))
  }
  filter.value = selectedValue
}

function renderAssignedStudents() {
  const tbody = byId('sectionStudentsTableBody')
  if (!tbody) return

  if (!assignedStudents.length) {
    tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><div class="empty-title">No students assigned</div><div class="empty-sub">Add eligible students to this section.</div></div></td></tr>'
    return
  }

  tbody.innerHTML = assignedStudents.map(student => `
    <tr>
      <td>${escapeHtml(student.name || '—')}</td>
      <td>${escapeHtml(student.student_id || '—')}</td>
      <td>${escapeHtml(student.email || '—')}</td>
      <td>${escapeHtml(gradeLabel(student.grade_level))}</td>
      <td><span class="pill ${String(student.status || 'active').toLowerCase() === 'active' ? 'pill-green' : 'pill-blue'}">${escapeHtml(student.status || 'active')}</span></td>
      <td>
        <button class="act-btn danger" type="button" title="Remove from section" aria-label="Remove ${escapeHtml(student.name)} from section" data-section-action="remove-student" data-student-id="${escapeHtml(student.id)}">🗑</button>
      </td>
    </tr>
  `).join('')
}

function renderEligibleStudents() {
  const tbody = byId('eligibleStudentsTableBody')
  if (!tbody) return

  const query = (byId('sectionStudentSearch')?.value || '').trim().toLocaleLowerCase()
  const filtered = eligibleStudents.filter(student =>
    !query || [student.name, student.student_id, student.email].some(value => String(value || '').toLocaleLowerCase().includes(query))
  )

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state"><div class="empty-title">No eligible students found</div><div class="empty-sub">Only unassigned students in this section’s grade level can be added.</div></div></td></tr>'
    return
  }

  tbody.innerHTML = filtered.map(student => `
    <tr>
      <td>${escapeHtml(student.name || '—')}</td>
      <td>${escapeHtml(student.student_id || '—')}</td>
      <td>${escapeHtml(student.email || '—')}</td>
      <td>${escapeHtml(gradeLabel(student.grade_level))}</td>
      <td><button class="btn btn-primary btn-sm" type="button" data-section-action="assign-student" data-student-id="${escapeHtml(student.id)}">Add</button></td>
    </tr>
  `).join('')
}

async function loadSections() {
  const tbody = byId('sectionsTableBody')
  if (tbody) tbody.innerHTML = '<tr><td colspan="4"><div class="loader"><div class="spinner"></div></div></td></tr>'

  const [sectionResult, studentResult] = await Promise.all([
    supabase.from('sections').select('id,name,grade_level').order('grade_level', { ascending: true }).order('name', { ascending: true }),
    supabase.from('profiles').select('section_id').eq('role', 'STUDENT').not('section_id', 'is', null)
  ])

  if (sectionResult.error) {
    sections = []
    sectionStudentCounts = new Map()
    renderSections()
    showToast('Sections unavailable', sectionResult.error.message || 'Unable to load sections.', 'error')
    return
  }

  sections = sectionResult.data || []
  populateSectionFilter()
  currentPage = 1
  sectionStudentCounts = new Map()
  if (studentResult.error) {
    showToast('Student counts unavailable', studentResult.error.message || 'Unable to load section student counts.', 'error')
  } else {
    for (const student of studentResult.data || []) {
      if (!student.section_id) continue
      const key = String(student.section_id)
      sectionStudentCounts.set(key, (sectionStudentCounts.get(key) || 0) + 1)
    }
  }

  renderSections()
  if (selectedSection) {
    selectedSection = sections.find(section => String(section.id) === String(selectedSection.id)) || null
    if (selectedSection && !byId('sectionStudentsPanel')?.classList.contains('hidden')) {
      await loadAssignedStudents()
    }
  }
}

function openSectionForm(section = null) {
  const form = byId('sectionForm')
  if (!form) return

  form.reset()
  editingSectionId = section?.id ?? null
  editingOriginalGrade = section ? gradeNumber(section.grade_level) : null
  byId('sectionModalTitle').textContent = section ? 'Edit Section' : 'Add Section'
  const gradeLevel = gradeNumber(section?.grade_level)
  byId('sectionName').value = section?.name || ''
  byId('sectionGradeLevel').value = GRADE_LEVELS.includes(gradeLevel) ? String(gradeLevel) : ''
  openSectionModal()
  byId('sectionName').focus()
}

async function sectionNameExists(name, gradeLevel, exceptId) {
  const { data, error } = await supabase.from('sections').select('id,name,grade_level')
  if (error) throw error

  const normalizedName = name.trim().toLocaleLowerCase()
  return (data || []).some(section =>
    String(section.name || '').trim().toLocaleLowerCase() === normalizedName &&
    gradeNumber(section.grade_level) === gradeLevel &&
    String(section.id) !== String(exceptId ?? '')
  )
}

async function saveSection(event) {
  event.preventDefault()
  const name = byId('sectionName').value.trim()
  const gradeLevel = Number(byId('sectionGradeLevel').value)
  const button = byId('saveSectionBtn')

  if (!name || !GRADE_LEVELS.includes(gradeLevel)) {
    showToast('Section not saved', 'Enter a section name and select a grade level from Grade 7 to Grade 12.', 'warning')
    return
  }

  const originalLabel = button.textContent
  button.disabled = true
  button.textContent = 'Saving...'

  try {
    if (await sectionNameExists(name, gradeLevel, editingSectionId)) {
      showToast('Duplicate section', 'A section with this name already exists for the selected grade level.', 'warning')
      return
    }

    if (editingSectionId && gradeLevel !== editingOriginalGrade) {
      const { data: students, error } = await supabase
        .from('profiles')
        .select('grade_level')
        .eq('role', 'STUDENT')
        .eq('section_id', editingSectionId)
      if (error) throw error
      if ((students || []).some(student => gradeNumber(student.grade_level) !== gradeLevel)) {
        showToast('Section not updated', 'Reassign or remove students whose grade level does not match before changing this section’s grade level.', 'warning')
        return
      }
    }

    const record = { name, grade_level: gradeLevel }
    const result = editingSectionId
      ? await supabase.from('sections').update(record).eq('id', editingSectionId).select('id').maybeSingle()
      : await supabase.from('sections').insert(record).select('id').single()

    if (result.error) throw result.error
    if (!result.data) throw new Error('No section was changed. Check your access permissions and try again.')

    showToast(editingSectionId ? 'Section updated' : 'Section added', `${name} was saved successfully.`, 'success')
    closeSectionModal()
    await loadSections()
  } catch (error) {
    showToast('Section not saved', error.message || 'Could not save this section.', 'error')
  } finally {
    button.disabled = false
    button.textContent = originalLabel
  }
}

async function checkSectionReferences(sectionId) {
  const [profilesResult, schedulesResult] = await Promise.all([
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('section_id', sectionId),
    supabase.from('schedules').select('id', { count: 'exact', head: true }).eq('section_id', sectionId)
  ])

  if (profilesResult.error) throw profilesResult.error
  if (schedulesResult.error) throw schedulesResult.error
  return {
    profiles: Number(profilesResult.count || 0),
    schedules: Number(schedulesResult.count || 0)
  }
}

async function deleteSection(section) {
  if (!window.confirm(`Delete ${section.name}? This action cannot be undone.`)) return

  try {
    const references = await checkSectionReferences(section.id)
    if (references.profiles || references.schedules) {
      const reasons = []
      if (references.profiles) reasons.push(`${references.profiles} profile${references.profiles === 1 ? '' : 's'}`)
      if (references.schedules) reasons.push(`${references.schedules} schedule${references.schedules === 1 ? '' : 's'}`)
      showToast('Section is in use', `Remove or reassign ${reasons.join(' and ')} before deleting this section.`, 'warning')
      return
    }

    const { data, error } = await supabase.from('sections').delete().eq('id', section.id).select('id').maybeSingle()
    if (error) throw error
    if (!data) throw new Error('No section was deleted. Check your access permissions and try again.')

    showToast('Section deleted', `${section.name} was deleted successfully.`, 'success')
    await loadSections()
  } catch (error) {
    const message = error.code === '23503'
      ? 'This section is still referenced by other records and cannot be deleted.'
      : error.message || 'Could not verify section references or delete this section.'
    showToast('Section not deleted', message, 'error')
  }
}

async function openSectionStudents(section) {
  selectedSection = section
  byId('sectionsListView').classList.add('hidden')
  byId('sectionStudentsPanel').classList.remove('hidden')
  byId('sectionDetailName').textContent = section.name || 'Section'
  byId('sectionDetailGrade').textContent = `Grade Level: ${gradeLabel(section.grade_level)}`
  await loadAssignedStudents()
}

async function loadAssignedStudents() {
  if (!selectedSection) return
  const tbody = byId('sectionStudentsTableBody')
  if (tbody) tbody.innerHTML = '<tr><td colspan="6"><div class="loader"><div class="spinner"></div></div></td></tr>'

  const { data, error } = await supabase
    .from('profiles')
    .select('id,name,email,student_id,grade_level,role,section_id,status')
    .eq('role', 'STUDENT')
    .eq('section_id', selectedSection.id)
    .order('name', { ascending: true })

  if (error) {
    assignedStudents = []
    renderAssignedStudents()
    showToast('Students unavailable', error.message || 'Unable to load students in this section.', 'error')
    return
  }

  assignedStudents = data || []
  byId('sectionDetailCount').textContent = `Students: ${assignedStudents.length}`
  renderAssignedStudents()
}

async function openEligibleStudents() {
  if (!selectedSection) return
  byId('addStudentToSectionTitle').textContent = `Add Student to ${selectedSection.name}`
  byId('sectionStudentSearch').value = ''
  byId('eligibleStudentsTableBody').innerHTML = '<tr><td colspan="5"><div class="loader"><div class="spinner"></div></div></td></tr>'
  byId('addStudentToSectionModal').classList.remove('hidden')

  const { data, error } = await supabase
    .from('profiles')
    .select('id,name,email,student_id,grade_level,section_id,role')
    .eq('role', 'STUDENT')
    .is('section_id', null)
    .order('name', { ascending: true })

  if (error) {
    eligibleStudents = []
    renderEligibleStudents()
    showToast('Students unavailable', error.message || 'Unable to load eligible students.', 'error')
    return
  }

  const selectedGrade = gradeNumber(selectedSection.grade_level)
  eligibleStudents = (data || []).filter(student => gradeNumber(student.grade_level) === selectedGrade)
  renderEligibleStudents()
}

async function assignStudent(studentId) {
  if (!selectedSection) return

  try {
    const { data: student, error: studentError } = await supabase
      .from('profiles')
      .select('id,role,grade_level,section_id')
      .eq('id', studentId)
      .eq('role', 'STUDENT')
      .maybeSingle()

    if (studentError) throw studentError
    if (!student) {
      showToast('Student not assigned', 'Only student accounts can be assigned to a section.', 'warning')
      return
    }

    if (gradeNumber(student.grade_level) !== gradeNumber(selectedSection.grade_level)) {
      showToast('Student not assigned', "This student cannot be added because the student's grade level does not match the section grade level.", 'warning')
      return
    }

    if (student.section_id) {
      const message = String(student.section_id) === String(selectedSection.id)
        ? 'This student is already assigned to this section.'
        : 'This student is already assigned to another section. Remove that assignment first.'
      showToast('Student not assigned', message, 'warning')
      return
    }

    const { data, error } = await supabase
      .from('profiles')
      .update({ section_id: selectedSection.id, status: 'Assigned' })
      .eq('id', student.id)
      .eq('role', 'STUDENT')
      .is('section_id', null)
      .select('id,status')
      .maybeSingle()

    if (error) throw error
    if (!data) throw new Error('The student assignment changed before it could be saved. Refresh and try again.')
    if (data.status !== 'Assigned') throw new Error(`Student was assigned, but the profile status is ${data.status || 'unchanged'} instead of Assigned.`)

    showToast('Student added', 'The student was assigned to this section.', 'success')
    closeStudentModal()
    document.dispatchEvent(new CustomEvent('section-student-profile-updated'))
    await loadSections()
  } catch (error) {
    showToast('Student not assigned', error.message || 'Could not assign this student to the section.', 'error')
  }
}

async function removeStudent(student) {
  if (!selectedSection || !window.confirm(`Remove ${student.name || 'this student'} from ${selectedSection.name}? Their profile will not be deleted.`)) return

  try {
    const { data, error } = await supabase
      .from('profiles')
      .update({ section_id: null, status: 'active' })
      .eq('id', student.id)
      .eq('role', 'STUDENT')
      .eq('section_id', selectedSection.id)
      .select('id,status')
      .maybeSingle()

    if (error) throw error
    if (!data) throw new Error('No student assignment was removed. Refresh and try again.')
    if (data.status !== 'active') throw new Error(`Student was removed, but the profile status is ${data.status || 'unchanged'} instead of active.`)

    showToast('Student removed', 'The student profile was kept and its status was reset to active.', 'success')
    document.dispatchEvent(new CustomEvent('section-student-profile-updated'))
    await loadSections()
  } catch (error) {
    showToast('Student not removed', error.message || 'Could not remove this student from the section.', 'error')
  }
}

export function initSectionsSection() {
  byId('addSectionBtn')?.addEventListener('click', () => openSectionForm())
  byId('sectionForm')?.addEventListener('submit', saveSection)
  byId('sectionSearch')?.addEventListener('input', () => {
    currentPage = 1
    renderSections()
  })
  byId('sectionGradeFilter')?.addEventListener('change', () => {
    currentPage = 1
    renderSections()
  })
  byId('sectionFilter')?.addEventListener('change', () => {
    currentPage = 1
    renderSections()
  })
  byId('sectionStudentSearch')?.addEventListener('input', renderEligibleStudents)
  byId('backToSectionsBtn')?.addEventListener('click', () => {
    selectedSection = null
    byId('sectionStudentsPanel').classList.add('hidden')
    byId('sectionsListView').classList.remove('hidden')
  })
  byId('addStudentToSectionBtn')?.addEventListener('click', openEligibleStudents)
  document.querySelectorAll('[data-close-section-modal]').forEach(button => button.addEventListener('click', closeSectionModal))
  document.querySelectorAll('[data-close-section-students-modal]').forEach(button => button.addEventListener('click', closeStudentModal))

  byId('sectionsTableBody')?.addEventListener('click', event => {
    const button = event.target.closest('[data-section-action]')
    if (!button) return
    const section = sections.find(item => String(item.id) === button.dataset.sectionId)
    if (!section) return

    if (button.dataset.sectionAction === 'edit') openSectionForm(section)
    if (button.dataset.sectionAction === 'manage') openSectionStudents(section)
    if (button.dataset.sectionAction === 'delete') deleteSection(section)
  })

  byId('sectionStudentsTableBody')?.addEventListener('click', event => {
    const button = event.target.closest('[data-section-action="remove-student"]')
    if (!button) return
    const student = assignedStudents.find(item => String(item.id) === button.dataset.studentId)
    if (student) removeStudent(student)
  })

  byId('eligibleStudentsTableBody')?.addEventListener('click', event => {
    const button = event.target.closest('[data-section-action="assign-student"]')
    if (button) assignStudent(button.dataset.studentId)
  })

  loadSections()
}