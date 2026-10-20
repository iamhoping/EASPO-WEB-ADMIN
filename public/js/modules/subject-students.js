import { supabase } from '../services/supabaseClient.js'
import { showToast } from '../ui/toast.js'
import { formatUserName } from '../utils/name-format.js'

let activeSubject = null
let activeSectionId = ''
let assignedStudents = []
let sectionNames = new Map()
let refreshTimer = null
let requestId = 0
let realtimeChannel = null

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
})[character])

const escapeAttr = value => escapeHtml(value).replace(/`/g, '&#96;')
const byId = id => document.getElementById(id)
const gradeLabel = value => value === null || value === undefined || value === ''
  ? '—'
  : `Grade ${String(value).replace(/^grade\s*/i, '')}`
const normalizedGrade = value => String(value ?? '').replace(/^grade\s*/i, '').trim()

function ensureModal() {
  if (byId('subjectStudentsModal')) return
  const modal = document.createElement('div')
  modal.id = 'subjectStudentsModal'
  modal.className = 'modal-overlay hidden'
  modal.setAttribute('role', 'dialog')
  modal.setAttribute('aria-modal', 'true')
  modal.setAttribute('aria-labelledby', 'subjectStudentsTitle')
  modal.innerHTML = `
    <div class="modal-box x-wide subject-students-modal">
      <div class="modal-head">
        <h2 id="subjectStudentsTitle">Subject Student List</h2>
        <button class="modal-close" type="button" data-close-subject-students aria-label="Close">&times;</button>
      </div>
      <div class="modal-body subject-students-body">
        <div class="subject-students-info" id="subjectStudentsInfo"></div>
        <div class="subject-students-toolbar">
          <label>
            <span>Search by student name or LRN</span>
            <input id="subjectStudentsSearch" class="filter-select" type="search" placeholder="Enter a name or LRN" />
          </label>
          <label>
            <span>Grade Level</span>
            <select id="subjectStudentsGrade" class="filter-select"><option value="">All Grades</option></select>
          </label>
          <label>
            <span>Section</span>
            <select id="subjectStudentsSection" class="filter-select"><option value="">All Sections</option></select>
          </label>
          <button class="btn btn-secondary" type="button" id="printSubjectStudents">Print Student List</button>
        </div>
        <p class="subject-students-count" id="subjectStudentsCount" aria-live="polite"></p>
        <div id="subjectStudentsError" class="subject-students-error hidden" role="alert"></div>
        <div class="table-wrap subject-students-table-wrap">
          <table class="data-table">
            <thead><tr><th>LRN Number</th><th>Student Name</th><th>Grade Level</th><th>Section</th><th>Gender</th></tr></thead>
            <tbody id="subjectStudentsTableBody"></tbody>
          </table>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-secondary" type="button" data-close-subject-students>Close</button>
      </div>
    </div>`
  document.body.appendChild(modal)
  injectStyles()

  modal.querySelectorAll('[data-close-subject-students]').forEach(button => {
    button.addEventListener('click', closeSubjectStudents)
  })
  modal.addEventListener('click', event => {
    if (event.target === modal) closeSubjectStudents()
  })
  byId('subjectStudentsSearch').addEventListener('input', renderStudents)
  byId('subjectStudentsGrade').addEventListener('change', renderStudents)
  byId('subjectStudentsSection').addEventListener('change', renderStudents)
  byId('printSubjectStudents').addEventListener('click', printSubjectStudents)
}

function injectStyles() {
  if (byId('subjectStudentsStyles')) return
  const style = document.createElement('style')
  style.id = 'subjectStudentsStyles'
  style.textContent = `
    .subject-students-modal{max-width:1000px}
    .subject-students-body{max-height:80vh}
    .subject-students-info{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:18px}
    .subject-students-info > div{padding:10px 12px;border:1px solid var(--border);border-radius:9px}
    .subject-students-info span,.subject-students-toolbar label span{display:block;color:var(--text3);font-size:.72rem}
    .subject-students-info strong{display:block;color:var(--text);font-size:.88rem;overflow-wrap:anywhere}
    .subject-students-toolbar{display:grid;grid-template-columns:minmax(180px,2fr) repeat(2,minmax(130px,1fr)) auto;gap:10px;align-items:end}
    .subject-students-toolbar label{display:block;color:var(--text2);font-size:.76rem;font-weight:700}
    .subject-students-toolbar .filter-select{width:100%;margin-top:5px}
    .subject-students-count{margin:14px 0 8px;color:var(--text2);font-weight:700}
    .subject-students-error{margin:12px 0;padding:12px;border:1px solid var(--red);border-radius:8px;color:var(--red)}
    .subject-students-table-wrap{max-height:44vh;overflow:auto}
    .subject-detail-link{padding:0;border:0;background:none;color:var(--primary);font:inherit;font-weight:700;text-align:left;cursor:pointer}
    .subject-detail-link:hover{text-decoration:underline}
    .subject-students-print-root{display:none}
    @media(max-width:760px){
      .subject-students-info{grid-template-columns:repeat(2,minmax(0,1fr))}
      .subject-students-toolbar{grid-template-columns:1fr 1fr}
      .subject-students-toolbar label:first-child{grid-column:1/-1}
      .subject-students-toolbar button{grid-column:1/-1}
      .subject-students-table-wrap{max-height:50vh}
    }
    @media print{
      @page{size:landscape;margin:12mm 12mm 18mm}
      body *{visibility:hidden!important}
      body>:not(#subjectStudentsPrintRoot):not(#reportPrintRoot){display:none!important}
      #subjectStudentsPrintRoot{display:block!important;position:relative;width:100%;padding-bottom:10mm;background:#fff;color:#111827;font:10pt/1.4 Arial,sans-serif}
      #subjectStudentsPrintRoot *{visibility:visible!important}
      .subject-students-print-header{display:flex;align-items:center;gap:18px;border-bottom:2px solid #1e3a5f;padding:0 0 12px;margin-bottom:18px}
      .subject-students-print-logo{width:72px;height:72px;object-fit:contain}
      .subject-students-print-school h1{font-size:17pt;margin:0 0 4px;color:#17365d}
      .subject-students-print-school p,.subject-students-print-heading p{font-size:9pt;margin:0;color:#4b5563}
      .subject-students-print-heading{text-align:center;margin:16px 0 20px}
      .subject-students-print-heading h2{font-size:14pt;margin:0 0 4px}
      .subject-students-print-details{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px 18px;margin-top:8px;text-align:left}
      .subject-students-print-details p{font-size:8.5pt!important}
      .subject-students-print-content table{width:100%;border-collapse:collapse;table-layout:auto;font-size:8.5pt}
      #subjectStudentsPrintRoot thead{display:table-header-group}
      .subject-students-print-content th,.subject-students-print-content td{border:1px solid #9ca3af;padding:5px 7px;text-align:left;vertical-align:top;overflow-wrap:anywhere}
      .subject-students-print-content th{background:#e8eef5!important;color:#111827;font-weight:700;print-color-adjust:exact;-webkit-print-color-adjust:exact}
      .subject-students-print-content tr{break-inside:avoid;page-break-inside:avoid}
      .subject-students-print-footer{position:fixed;left:0;right:0;bottom:-14mm;border-top:1px solid #9ca3af;padding-top:4px;display:flex;justify-content:space-between;font-size:8pt;color:#4b5563}
      .subject-students-print-page:after{content:counter(page)}
    }`
  document.head.appendChild(style)
}

function renderSubjectInfo() {
  const subject = activeSubject
  const selectedSection = activeSectionId || byId('subjectStudentsSection')?.value || ''
  const selectedGrade = byId('subjectStudentsGrade')?.value || ''
  const section = selectedSection ? sectionNames.get(String(selectedSection)) : ''
  byId('subjectStudentsInfo').innerHTML = `
    <div><span>Subject</span><strong>${escapeHtml(subject?.name || '—')}</strong></div>
    <div><span>Subject Code</span><strong>${escapeHtml(subject?.code || '—')}</strong></div>
    <div><span>Grade Level</span><strong>${escapeHtml(gradeLabel(selectedGrade || subject?.grade_level))}</strong></div>
    <div><span>Section</span><strong>${escapeHtml(section || (selectedSection ? `Section ${selectedSection}` : 'All assigned sections'))}</strong></div>
    <div><span>Units</span><strong>${escapeHtml(subject?.units ?? '—')}</strong></div>`
}

function fillFilters() {
  const gradeSelect = byId('subjectStudentsGrade')
  const sectionSelect = byId('subjectStudentsSection')
  const gradeValue = gradeSelect.value
  const sectionValue = sectionSelect.value
  const grades = [...new Set(assignedStudents.map(student => normalizedGrade(student.grade_level)).filter(Boolean))]
    .sort((left, right) => (Number(left) || 0) - (Number(right) || 0))
  const sections = [...new Set(assignedStudents.map(student => String(student.section_id || '')).filter(Boolean))]
    .sort((left, right) => (sectionNames.get(left) || left).localeCompare(sectionNames.get(right) || right))

  gradeSelect.innerHTML = '<option value="">All Grades</option>' + grades.map(grade =>
    `<option value="${escapeAttr(grade)}">${escapeHtml(gradeLabel(grade))}</option>`
  ).join('')
  sectionSelect.innerHTML = '<option value="">All Sections</option>' + sections.map(sectionId =>
    `<option value="${escapeAttr(sectionId)}">${escapeHtml(sectionNames.get(sectionId) || `Section ${sectionId}`)}</option>`
  ).join('')

  gradeSelect.value = grades.includes(gradeValue) ? gradeValue : ''
  sectionSelect.value = sections.includes(sectionValue) ? sectionValue : (activeSectionId || '')
}

function getFilteredStudents() {
  const query = (byId('subjectStudentsSearch')?.value || '').trim().toLocaleLowerCase()
  const grade = byId('subjectStudentsGrade')?.value || ''
  const section = byId('subjectStudentsSection')?.value || ''
  return assignedStudents.filter(student => {
    const name = formatUserName(student.name)
    const searchMatches = !query || `${name} ${student.student_id || ''}`.toLocaleLowerCase().includes(query)
    return searchMatches &&
      (!grade || normalizedGrade(student.grade_level) === grade) &&
      (!section || String(student.section_id || '') === section)
  })
}

function renderStudents() {
  const tbody = byId('subjectStudentsTableBody')
  if (!tbody) return
  const filtered = getFilteredStudents()
  const total = assignedStudents.length
  byId('subjectStudentsCount').textContent = `${total} ${total === 1 ? 'Student' : 'Students'} assigned · ${filtered.length} shown`
  renderSubjectInfo()

  if (!total) {
    tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state"><div class="empty-title">0 Students</div><div class="empty-sub">No active students are assigned to this subject through its scheduled sections.</div></div></td></tr>'
    return
  }
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state"><div class="empty-title">No matching students</div><div class="empty-sub">Adjust your search or filters.</div></div></td></tr>'
    return
  }

  tbody.innerHTML = filtered.map(student => `
    <tr>
      <td><code>${escapeHtml(student.student_id || '—')}</code></td>
      <td>${escapeHtml(formatUserName(student.name) || 'Unnamed Student')}</td>
      <td>${escapeHtml(gradeLabel(student.grade_level))}</td>
      <td>${escapeHtml(sectionNames.get(String(student.section_id)) || '—')}</td>
      <td>${escapeHtml(student.gender || '—')}</td>
    </tr>
  `).join('')
}

function subjectMatchesSchedule(subject, schedule) {
  const normalizeSubject = value => String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase()
  const scheduledSubject = normalizeSubject(schedule.subject)
  const subjectValues = [subject.name, subject.code]
    .map(normalizeSubject)
    .filter(Boolean)
  return Boolean(scheduledSubject && subjectValues.includes(scheduledSubject))
}

async function fetchAllStudentRows(sectionIds, id) {
  const result = []
  const pageSize = 1000
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from('profiles')
      .select('id,name,student_id,grade_level,section_id,gender,status')
      .eq('role', 'STUDENT')
      .in('section_id', sectionIds)
      .order('name', { ascending: true })
      .range(offset, offset + pageSize - 1)
    if (id !== requestId) return []
    if (error) throw error
    result.push(...(data || []))
    if (!data || data.length < pageSize) return result
  }
}

async function loadAssignedStudents() {
  const id = ++requestId
  const tbody = byId('subjectStudentsTableBody')
  const errorBox = byId('subjectStudentsError')
  errorBox.classList.add('hidden')
  errorBox.textContent = ''
  byId('subjectStudentsCount').textContent = 'Loading assigned students…'
  tbody.innerHTML = '<tr><td colspan="5"><div class="loader"><div class="spinner"></div></div></td></tr>'

  try {
    const { data: schedules, error: scheduleError } = await supabase
      .from('schedules')
      .select('id,section_id,subject')
    if (scheduleError) throw scheduleError

    let matchingSchedules = (schedules || []).filter(schedule => subjectMatchesSchedule(activeSubject, schedule))
    if (activeSectionId) {
      matchingSchedules = matchingSchedules.filter(schedule => String(schedule.section_id || '') === String(activeSectionId))
    }
    const sectionIds = [...new Set(matchingSchedules.map(schedule => schedule.section_id).filter(Boolean).map(String))]
    let sections = []
    if (sectionIds.length) {
      const { data, error } = await supabase.from('sections').select('id,name,grade_level').in('id', sectionIds)
      if (error) throw error
      sections = data || []
    }
    if (id !== requestId) return
    sectionNames = new Map(sections.map(section => [String(section.id), section.name || `Section ${section.id}`]))

    let students = sectionIds.length ? await fetchAllStudentRows(sectionIds, id) : []
    if (id !== requestId) return
    const seen = new Set()
    assignedStudents = students.filter(student => {
      const status = String(student.status || 'active').toLowerCase()
      if (['inactive', 'archived'].includes(status) || seen.has(student.id)) return false
      seen.add(student.id)
      return true
    })
    fillFilters()
    renderSubjectInfo()
    renderStudents()
  } catch (error) {
    if (id !== requestId) return
    assignedStudents = []
    byId('subjectStudentsCount').textContent = 'Student count unavailable'
    tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state"><div class="empty-title">Could not load assigned students</div><div class="empty-sub">See the error above, then retry or contact an administrator.</div></div></td></tr>'
    errorBox.textContent = `Assigned students could not be loaded: ${error.message || 'Unknown error.'}`
    errorBox.classList.remove('hidden')
    showToast('Subject students unavailable', error.message || 'Unable to load assigned students.', 'error')
  }
}

function startRealtimeRefresh() {
  if (realtimeChannel) supabase.removeChannel(realtimeChannel)
  realtimeChannel = supabase.channel(`subject-students-${Date.now()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, scheduleRealtimeRefresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'schedules' }, scheduleRealtimeRefresh)
    .subscribe()
}

function scheduleRealtimeRefresh() {
  clearTimeout(refreshTimer)
  refreshTimer = setTimeout(loadAssignedStudents, 250)
}

async function loadBranding() {
  const { data, error } = await supabase.rpc('get_public_school_branding')
  if (error) throw error
  const settings = Object.fromEntries((data || []).map(row => [row.key, row.value]))
  const fallbackLogo = document.querySelector('[data-school-logo]:not(link), .sidebar-logo')?.src || 'logo.png'
  return {
    name: String(settings.school_name || 'Eastern Porac National High School').trim(),
    address: String(settings.school_address || '').trim(),
    logo: String(settings.school_logo_url || fallbackLogo).trim(),
  }
}

async function printSubjectStudents() {
  try {
    const branding = await loadBranding()
    const filtered = getFilteredStudents()
    let printRoot = byId('subjectStudentsPrintRoot')
    if (!printRoot) {
      printRoot = document.createElement('main')
      printRoot.id = 'subjectStudentsPrintRoot'
      printRoot.className = 'subject-students-print-root'
      document.body.appendChild(printRoot)
    }

    const generated = new Date().toLocaleString()
    const section = activeSectionId || byId('subjectStudentsSection').value
    const grade = byId('subjectStudentsGrade').value
    printRoot.innerHTML = `
      <header class="subject-students-print-header">
        <img class="subject-students-print-logo" src="${escapeAttr(branding.logo)}" alt="School logo">
        <div class="subject-students-print-school"><h1>${escapeHtml(branding.name)}</h1><p>${escapeHtml(branding.address || 'School address not configured')}</p></div>
      </header>
      <section class="subject-students-print-heading">
        <h2>Subject Student List</h2>
        <div class="subject-students-print-details">
          <p><strong>Subject:</strong> ${escapeHtml(activeSubject.name || '—')}</p>
          <p><strong>Subject Code:</strong> ${escapeHtml(activeSubject.code || '—')}</p>
          <p><strong>Grade Level:</strong> ${escapeHtml(gradeLabel(grade || activeSubject.grade_level))}</p>
          <p><strong>Section:</strong> ${escapeHtml(sectionNames.get(section) || (section ? `Section ${section}` : 'All assigned sections'))}</p>
          <p><strong>Total assigned:</strong> ${assignedStudents.length} · <strong>Shown:</strong> ${filtered.length}</p>
          <p><strong>Date generated:</strong> ${escapeHtml(generated)}</p>
        </div>
      </section>
      <div class="subject-students-print-content">
        <table><thead><tr><th>LRN Number</th><th>Student Name</th><th>Grade Level</th><th>Section</th><th>Gender</th></tr></thead>
          <tbody>${filtered.map(student => `<tr><td>${escapeHtml(student.student_id || '—')}</td><td>${escapeHtml(formatUserName(student.name) || 'Unnamed Student')}</td><td>${escapeHtml(gradeLabel(student.grade_level))}</td><td>${escapeHtml(sectionNames.get(String(student.section_id)) || '—')}</td><td>${escapeHtml(student.gender || '—')}</td></tr>`).join('') || '<tr><td colspan="5">No students match the selected filters.</td></tr>'}</tbody>
        </table>
      </div>
      <footer class="subject-students-print-footer">
        <span>${escapeHtml(branding.name)} · Official Report</span>
        <span>Page <span class="subject-students-print-page"></span></span>
      </footer>`
    window.print()
  } catch (error) {
    showToast('Print not ready', error.message || 'The subject student list could not be prepared for printing.', 'error')
  }
}

export function openSubjectStudentList(subject, { sectionId = '' } = {}) {
  if (!subject?.id && !subject?.name && !subject?.code) {
    showToast('Subject unavailable', 'The selected subject could not be identified.', 'error')
    return
  }
  ensureModal()
  activeSubject = { ...subject }
  activeSectionId = sectionId ? String(sectionId) : ''
  assignedStudents = []
  byId('subjectStudentsSearch').value = ''
  byId('subjectStudentsGrade').innerHTML = '<option value="">All Grades</option>'
  byId('subjectStudentsSection').innerHTML = '<option value="">All Sections</option>'
  byId('subjectStudentsSection').disabled = Boolean(activeSectionId)
  renderSubjectInfo()
  byId('subjectStudentsModal').classList.remove('hidden')
  loadAssignedStudents()
  startRealtimeRefresh()
}

function closeSubjectStudents() {
  requestId += 1
  clearTimeout(refreshTimer)
  if (realtimeChannel) {
    supabase.removeChannel(realtimeChannel)
    realtimeChannel = null
  }
  byId('subjectStudentsModal')?.classList.add('hidden')
  byId('subjectStudentsPrintRoot')?.replaceChildren()
  activeSubject = null
  activeSectionId = ''
}

window.addEventListener('afterprint', () => {
  byId('subjectStudentsPrintRoot')?.replaceChildren()
})
