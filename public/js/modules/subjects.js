import { supabase } from '../services/supabaseClient.js'
import { showToast } from '../ui/toast.js'
import { renderPagination } from '../ui/pagination.js'

const GRADE_LEVELS = [7, 8, 9, 10, 11, 12]
const PER_PAGE = 10
const LINKED_TABLES = [
  { table: 'schedules', label: 'schedules' },
  { table: 'grades', label: 'grade records' },
  { table: 'attendance', label: 'attendance records' }
]

let subjects = []
let editingId = null
let currentPage = 1

const byId = id => document.getElementById(id)
const openModal = () => byId('subjectModal')?.classList.remove('hidden')
const closeModal = () => byId('subjectModal')?.classList.add('hidden')
const numericGradeLevel = value => Number(String(value ?? '').replace(/^grade\s*/i, ''))
const formatGradeLevel = value => value === null || value === undefined || value === ''
  ? '—'
  : `Grade ${String(value).replace(/^grade\s*/i, '')}`
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
})[character])

function renderSubjects() {
  const tbody = byId('subjectsTableBody')
  const count = byId('subjectsCount')
  if (!tbody) return

  const query = (byId('subjectSearch')?.value || '').trim().toLocaleLowerCase()
  const grade = byId('subjectGradeFilter')?.value || ''
  const selectedSubject = byId('subjectFilter')?.value || ''
  const filteredSubjects = subjects.filter(subject =>
    (!query || [subject.code, subject.name].some(value => String(value || '').toLocaleLowerCase().includes(query))) &&
    (!grade || String(numericGradeLevel(subject.grade_level)) === grade) &&
    (!selectedSubject || String(subject.id) === selectedSubject)
  )

  if (!filteredSubjects.length) {
    tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state"><div class="empty-title">No subjects found</div><div class="empty-sub">Adjust your search or filters to see more subjects.</div></div></td></tr>'
    if (count) count.textContent = '0 subjects'
    renderPagination('subjectsPagination', 1, 0, () => {})
    return
  }

  const totalPages = Math.ceil(filteredSubjects.length / PER_PAGE)
  currentPage = Math.min(currentPage, totalPages)
  const start = (currentPage - 1) * PER_PAGE
  const pageSubjects = filteredSubjects.slice(start, start + PER_PAGE)

  tbody.innerHTML = pageSubjects.map(subject => `
    <tr>
      <td><code>${escapeHtml(subject.code || '—')}</code></td>
      <td>${escapeHtml(subject.name || '—')}</td>
      <td>${escapeHtml(formatGradeLevel(subject.grade_level))}</td>
      <td>${escapeHtml(subject.units ?? '—')}</td>
      <td>
        <div class="row-acts">
          <button class="act-btn" type="button" title="Edit" aria-label="Edit ${escapeHtml(subject.name || subject.code)}" data-subject-action="edit" data-subject-id="${escapeHtml(subject.id)}">✏️</button>
          <button class="act-btn danger" type="button" title="Delete" aria-label="Delete ${escapeHtml(subject.name || subject.code)}" data-subject-action="delete" data-subject-id="${escapeHtml(subject.id)}">🗑</button>
        </div>
      </td>
    </tr>
  `).join('')

  if (count) count.textContent = `Showing ${start + 1}-${Math.min(start + PER_PAGE, filteredSubjects.length)} of ${filteredSubjects.length} subjects`
  renderPagination('subjectsPagination', currentPage, totalPages, page => {
    currentPage = page
    renderSubjects()
  })
}

function populateSubjectFilter() {
  const filter = byId('subjectFilter')
  if (!filter) return

  const selectedValue = filter.value
  filter.replaceChildren(new Option('All Subjects', ''))
  for (const subject of subjects) {
    const label = subject.name && subject.code ? `${subject.name} (${subject.code})` : subject.name || subject.code || 'Unnamed Subject'
    filter.add(new Option(label, String(subject.id)))
  }
  filter.value = selectedValue
}

export async function loadSubjects() {
  const tbody = byId('subjectsTableBody')
  if (tbody) tbody.innerHTML = '<tr><td colspan="5"><div class="loader"><div class="spinner"></div></div></td></tr>'

  const { data, error } = await supabase
    .from('subjects')
    .select('id,code,name,grade_level,units')
    .order('grade_level', { ascending: true })
    .order('code', { ascending: true })

  if (error) {
    subjects = []
    currentPage = 1
    renderSubjects()
    showToast('Subjects unavailable', error.message || 'Unable to load subjects.', 'error')
    return
  }

  subjects = data || []
  populateSubjectFilter()
  currentPage = 1
  renderSubjects()
}

function openSubjectModal(subject = null) {
  const form = byId('subjectForm')
  if (!form) return

  form.reset()
  editingId = subject?.id ?? null
  byId('subjectModalTitle').textContent = subject ? 'Edit Subject' : 'Add Subject'
  byId('subjectCode').value = subject?.code || ''
  byId('subjectName').value = subject?.name || ''
  const gradeLevel = numericGradeLevel(subject?.grade_level)
  byId('subjectGradeLevel').value = GRADE_LEVELS.includes(gradeLevel) ? String(gradeLevel) : ''
  byId('subjectUnits').value = subject?.units ?? ''
  openModal()
  byId('subjectCode').focus()
}

async function hasDuplicateCode(code, exceptId) {
  const { data, error } = await supabase.from('subjects').select('id,code')
  if (error) throw error

  return (data || []).some(subject =>
    String(subject.code || '').trim().toLocaleLowerCase() === code.toLocaleLowerCase() &&
    String(subject.id) !== String(exceptId ?? '')
  )
}

async function saveSubject(event) {
  event.preventDefault()
  const code = byId('subjectCode').value.trim()
  const name = byId('subjectName').value.trim()
  const gradeLevel = Number(byId('subjectGradeLevel').value)
  const units = Number(byId('subjectUnits').value)
  const button = byId('saveSubjectBtn')

  if (!code || !name || !GRADE_LEVELS.includes(gradeLevel) || !Number.isInteger(units) || units < 1) {
    showToast('Subject not saved', 'Complete all fields with a valid grade level and positive whole-number units.', 'warning')
    return
  }

  const originalLabel = button.textContent
  button.disabled = true
  button.textContent = 'Saving...'

  try {
    if (await hasDuplicateCode(code, editingId)) {
      showToast('Duplicate subject code', 'A subject with this code already exists.', 'warning')
      return
    }

    const record = { code, name, grade_level: gradeLevel, units }
    const result = editingId
      ? await supabase.from('subjects').update(record).eq('id', editingId).select('id').maybeSingle()
      : await supabase.from('subjects').insert(record).select('id').single()

    if (result.error) throw result.error
    if (!result.data) throw new Error('No subject was changed. Check your access permissions and try again.')

    showToast(editingId ? 'Subject updated' : 'Subject added', `${name} was saved successfully.`, 'success')
    closeModal()
    await loadSubjects()
  } catch (error) {
    const message = error.code === '23505'
      ? 'A subject with this code already exists.'
      : error.message || 'Could not save this subject.'
    showToast('Subject not saved', message, 'error')
  } finally {
    button.disabled = false
    button.textContent = originalLabel
  }
}

async function checkSubjectReferences(subjectId) {
  const results = await Promise.all(LINKED_TABLES.map(({ table }) =>
    supabase.from(table).select('id', { count: 'exact', head: true }).eq('subject_id', subjectId)
  ))

  const failed = results.find(result => result.error)
  if (failed) throw failed.error

  return LINKED_TABLES
    .filter((_, index) => Number(results[index].count || 0) > 0)
    .map(({ label }) => label)
}

async function deleteSubject(subject) {
  const label = subject.name || subject.code || 'this subject'
  if (!window.confirm(`Delete ${label}? This action cannot be undone.`)) return

  try {
    const references = await checkSubjectReferences(subject.id)
    if (references.length) {
      showToast('Subject is in use', `This subject is still referenced by ${references.join(', ')} and cannot be deleted.`, 'warning')
      return
    }

    const { data, error } = await supabase.from('subjects').delete().eq('id', subject.id).select('id').maybeSingle()
    if (error) throw error
    if (!data) throw new Error('No subject was deleted. Check your access permissions and try again.')

    showToast('Subject deleted', `${label} was deleted successfully.`, 'success')
    await loadSubjects()
  } catch (error) {
    const message = error.code === '23503'
      ? 'This subject is still referenced by other records and cannot be deleted.'
      : error.message || 'Could not verify subject references or delete this subject.'
    showToast('Subject not deleted', message, 'error')
  }
}

export function initSubjectsSection() {
  byId('addSubjectBtn')?.addEventListener('click', () => openSubjectModal())
  for (const id of ['subjectSearch', 'subjectGradeFilter', 'subjectFilter']) {
    byId(id)?.addEventListener(id === 'subjectSearch' ? 'input' : 'change', () => {
      currentPage = 1
      renderSubjects()
    })
  }
  byId('subjectForm')?.addEventListener('submit', saveSubject)
  document.querySelectorAll('[data-close-subject-modal]').forEach(button => {
    button.addEventListener('click', closeModal)
  })
  byId('subjectsTableBody')?.addEventListener('click', event => {
    const button = event.target.closest('[data-subject-action]')
    if (!button) return

    const subject = subjects.find(item => String(item.id) === button.dataset.subjectId)
    if (!subject) return
    if (button.dataset.subjectAction === 'edit') openSubjectModal(subject)
    if (button.dataset.subjectAction === 'delete') deleteSubject(subject)
  })
  loadSubjects()
}