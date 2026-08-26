// /js/modules/grades.js
import { supabase } from '../services/supabaseClient.js'
import { showToast } from '../ui/toast.js'

let allGrades   = []
let allStudents = []
let filtered    = []
let currentPage = 1
const PER_PAGE  = 15

const val   = id => (document.getElementById(id)?.value || '').trim()
const openM = id => document.getElementById(id)?.classList.remove('hidden')
const closeM= id => document.getElementById(id)?.classList.add('hidden')

// Score → letter grade
function letterGrade(score) {
  const s = Number(score)
  if (s >= 90) return 'A'
  if (s >= 80) return 'B'
  if (s >= 70) return 'C'
  if (s >= 60) return 'D'
  return 'F'
}

function gradeColor(letter) {
  return { A:'grade-A', B:'grade-B', C:'grade-C', D:'grade-D', F:'grade-F' }[letter] || 'grade-F'
}

function scoreBarColor(score) {
  const s = Number(score)
  if (s >= 90) return 'var(--green)'
  if (s >= 80) return 'var(--primary)'
  if (s >= 70) return 'var(--yellow)'
  if (s >= 60) return 'var(--orange)'
  return 'var(--red)'
}

// ── Populate student dropdowns ────────────────────────────────
async function fetchStudents() {
  const { data } = await supabase
    .from('profiles')
    .select('id,name,student_id,grade_level')
    .eq('role','STUDENT')
    .order('name',{ascending:true})
  allStudents = data || []
  populateDropdowns()
}

function populateDropdowns() {
  const opts = `<option value="">Select student…</option>` +
    allStudents.map(s =>
      `<option value="${s.id}">${s.name} (${s.grade_level||'—'})</option>`
    ).join('')

  ;['gradeStudent','editGradeStudent'].forEach(id => {
    const el = document.getElementById(id)
    if (el) el.innerHTML = opts
  })
}

// ── Load ──────────────────────────────────────────────────────
export async function loadGrades() {
  const tbody = document.getElementById('gradesTableBody')
  if (tbody) tbody.innerHTML = `<tr><td colspan="8"><div class="loader"><div class="spinner"></div></div></td></tr>`

  await fetchStudents()

  const { data, error } = await supabase
  .from('grades')
  .select(`
      *,
      profiles:student_id (name, grade_level)
    `)
  .order('created_at', { ascending: false })

  if (error) {
    console.warn('grades load:', error.message)
    allGrades = []
  } else {
    allGrades = data || []
  }

  updateGradeStats()
  applyFilters()
}

// ── Stats ─────────────────────────────────────────────────────
function updateGradeStats() {
  const el = document.getElementById('totalGrades')
  if (el) el.textContent = allGrades.length

  const avgEl = document.getElementById('avgGwa')
  if (avgEl && allGrades.length) {
    const avg = allGrades.reduce((sum, g) => sum + Number(g.score||0), 0) / allGrades.length
    avgEl.textContent = avg.toFixed(1)
  } else if (avgEl) {
    avgEl.textContent = '—'
  }
}

// ── Filter ────────────────────────────────────────────────────
export function applyFilters() {
  const q  = val('gradesSearch').toLowerCase()
  const gr = document.getElementById('gradesGradeFilter')?.value  || ''
  const sb = document.getElementById('subjectFilter')?.value      || ''
  const qt = document.getElementById('quarterFilter')?.value      || ''

  filtered = allGrades.filter(g => {
    const name  = g.profiles?.name        || ''
    const grade = g.profiles?.grade_level || ''
    return (
      (!q  || name.toLowerCase().includes(q) || (g.subject||'').toLowerCase().includes(q)) &&
      (!gr || grade === gr) &&
      (!sb || g.subject === sb) &&
      (!qt || g.quarter === qt)
    )
  })
  currentPage = 1
  render()
}

// ── Render ────────────────────────────────────────────────────
function render() {
  const tbody   = document.getElementById('gradesTableBody')
  const countEl = document.getElementById('gradesCount')
  const total   = filtered.length
  if (!tbody) return

  if (!total) {
    tbody.innerHTML = `
      <tr><td colspan="8">
        <div class="empty-state">
          <div class="empty-icon">📝</div>
          <div class="empty-title">No grade records</div>
          <div class="empty-sub">Add a grade entry or adjust your filters.</div>
        </div>
      </td></tr>`
    if (countEl) countEl.textContent = '0 records'
    const pg = document.getElementById('gradesPagination')
    if (pg) pg.innerHTML = ''
    return
  }

  const start = (currentPage - 1) * PER_PAGE
  const slice = filtered.slice(start, start + PER_PAGE)
  const pages = Math.ceil(total / PER_PAGE)

  tbody.innerHTML = slice.map(g => {
    const name    = g.profiles?.name        || 'Unknown'
    const glevel  = g.profiles?.grade_level || '—'
    const score   = Number(g.score || 0)
    const letter  = letterGrade(score)
    const clr     = gradeColor(letter)
    const barClr  = scoreBarColor(score)

    return `
    <tr>
      <td class="cb-cell"><input type="checkbox"/></td>
      <td>
        <div class="ent-row">
          <div>
            <div class="ent-name">${name}</div>
            <div class="ent-sub">${g.academic_year || '—'}</div>
          </div>
        </div>
      </td>
      <td><span class="pill pill-blue">${glevel}</span></td>
      <td style="font-size:.84rem;font-weight:500;color:var(--text)">${g.subject || '—'}</td>
      <td><span class="pill pill-purple">${g.quarter || '—'}</span></td>
      <td>
        <div style="display:flex;align-items:center;gap:10px;min-width:100px">
          <div class="score-bar-wrap">
            <div class="score-bar" style="width:${score}%;background:${barClr}"></div>
          </div>
          <span style="font-family:var(--font-head);font-weight:700;font-size:.88rem;color:var(--text);white-space:nowrap">${score}</span>
        </div>
      </td>
      <td>
        <div class="grade-badge ${clr}">${letter}</div>
      </td>
      <td>
        <div class="row-acts">
          <button class="act-btn" title="Edit"   onclick="openEditGradeModal('${g.id}')">✏️</button>
          <button class="act-btn danger" title="Delete" onclick="confirmDeleteGrade('${g.id}','${name.replace(/'/g,"\\'")}')">🗑</button>
        </div>
      </td>
    </tr>`
  }).join('')

  if (countEl) countEl.textContent = `Showing ${start+1}–${Math.min(start+PER_PAGE,total)} of ${total} records`
  renderPages('gradesPagination', currentPage, pages, p => { currentPage = p; render() })
}

// ── Add ───────────────────────────────────────────────────────
export async function submitAddGrade() {
  const form          = document.getElementById('addGradeForm')
  const editingId     = form?.dataset.editId
  const student_id    = val('gradeStudent')
  const subject       = val('gradeSubject')
  const quarter       = val('gradeQuarter')
  const score         = val('gradeScore')
  const academic_year = val('gradeYear') || '2024-2025'
  const remarks       = val('gradeRemarks')

  if (!student_id || !subject || !quarter || !score)
    return showToast('Missing fields', 'Fill all required fields', 'warning')

  const numScore = Number(score)
  if (isNaN(numScore) || numScore < 0 || numScore > 100)
    return showToast('Invalid score', 'Score must be between 0 and 100', 'warning')

  if (editingId) {
    const updateData = { student_id, subject, quarter, score: numScore, remarks: remarks||null }
    if (document.getElementById('gradeYear')) updateData.academic_year = academic_year
    const { error } = await supabase
      .from('grades')
      .update(updateData)
      .eq('id', editingId)
    if (error) return showToast('Error', error.message, 'error')
    showToast('Updated', 'Grade record updated', 'success')
    closeM('addGradeModal')
    form.reset()
    delete form.dataset.editId
    document.getElementById('addGradeModal').querySelector('.modal-head h2').textContent = 'Add Grade Record'
    loadGrades()
    return
  }

  // Check for duplicate
  const { data: existing } = await supabase
    .from('grades')
    .select('id')
    .eq('student_id', student_id)
    .eq('subject', subject)
    .eq('quarter', quarter)
    .eq('academic_year', academic_year)
    .maybeSingle()

  if (existing) {
    if (!confirm('A grade record already exists for this student, subject, and quarter. Update it?')) return
    const { error } = await supabase
      .from('grades')
      .update({ score: numScore, remarks: remarks||null })
      .eq('id', existing.id)
    if (error) return showToast('Error', error.message, 'error')
    showToast('Updated', 'Grade record updated', 'success')
  } else {
    const { error } = await supabase
      .from('grades')
      .insert([{ student_id, subject, quarter, score: numScore, academic_year, remarks: remarks||null }])
    if (error) return showToast('Error', error.message, 'error')
    showToast('Grade Saved', `${letterGrade(numScore)} recorded for ${subject}`, 'success')
  }

  closeM('addGradeModal')
  document.getElementById('addGradeForm')?.reset()
  loadGrades()
}

// ── Edit ──────────────────────────────────────────────────────
export async function openEditGradeModal(id) {
  const { data: g, error } = await supabase
    .from('grades')
    .select('*')
    .eq('id', id)
    .single()
  if (error) return showToast('Error', 'Could not load grade', 'error')

  // Reuse addGradeModal for editing — pre-populate
  const modal = document.getElementById('addGradeModal')
  const studentSelect = document.getElementById('gradeStudent')
  const subjectSelect = document.getElementById('gradeSubject')
  const yearInput = document.getElementById('gradeYear')
  modal.querySelector('.modal-head h2').textContent = 'Edit Grade Record'
  studentSelect.value = g.student_id || ''
  subjectSelect.innerHTML = `<option value="${g.subject || ''}">${g.subject || 'No subject'}</option>`
  subjectSelect.value = g.subject || ''
  studentSelect.disabled = true
  subjectSelect.disabled = true
  document.getElementById('gradeQuarter').value  = g.quarter     || ''
  document.getElementById('gradeScore').value    = g.score       ?? ''
  if (yearInput) yearInput.value = g.academic_year || '2024-2025'
  document.getElementById('gradeRemarks').value  = g.remarks     || ''

  // Store editing ID
  document.getElementById('addGradeForm').dataset.editId = id
  openM('addGradeModal')
}

function resetGradeModalForAdd() {
  const modal = document.getElementById('addGradeModal')
  const form = document.getElementById('addGradeForm')
  const studentSelect = document.getElementById('gradeStudent')
  const subjectSelect = document.getElementById('gradeSubject')
  modal.querySelector('.modal-head h2').textContent = 'Add Grade Record'
  form.reset()
  delete form.dataset.editId
  studentSelect.disabled = false
  subjectSelect.disabled = false
  subjectSelect.innerHTML = `
    <option value="">Select subject...</option>
    <option value="Mathematics">Mathematics</option>
    <option value="Science">Science</option>
    <option value="English">English</option>
    <option value="Filipino">Filipino</option>
    <option value="History">History</option>
    <option value="MAPEH">MAPEH</option>
    <option value="Values Education">Values Education</option>
    <option value="Technology">Technology</option>`
}

// ── Delete ────────────────────────────────────────────────────
window.confirmDeleteGrade = function(id, name) {
  if (!confirm(`Delete grade record for "${name}"?`)) return
  supabase.from('grades').delete().eq('id', id).then(({ error }) => {
    if (error) return showToast('Error', error.message, 'error')
    showToast('Deleted', 'Grade record removed', 'success')
    loadGrades()
  })
}

// ── Export ────────────────────────────────────────────────────
function exportCSV() {
  if (!allGrades.length) return showToast('Empty', 'Nothing to export', 'warning')
  const h = ['Student','Grade Level','Subject','Quarter','Score','Letter Grade','Academic Year','Remarks']
  const r = allGrades.map(g => [
    g.profiles?.name,
    g.profiles?.grade_level,
    g.subject,
    g.quarter,
    g.score,
    letterGrade(g.score),
    g.academic_year,
    g.remarks
  ].map(x => `"${x||''}"`).join(','))
  const a = Object.assign(document.createElement('a'), {
    href     : URL.createObjectURL(new Blob([[h, ...r].join('\n')], { type: 'text/csv' })),
    download : 'grades.csv'
  }); a.click()
}

// ── Init ──────────────────────────────────────────────────────
export function initGradesSection() {
  document.getElementById('addGradeBtn')?.addEventListener('click', () => {
    resetGradeModalForAdd()
    openM('addGradeModal')
  })

  document.getElementById('gradesSearch')?.addEventListener('input', applyFilters)
  document.getElementById('gradesGradeFilter')?.addEventListener('change', applyFilters)
  document.getElementById('subjectFilter')?.addEventListener('change', applyFilters)
  document.getElementById('quarterFilter')?.addEventListener('change', applyFilters)
  document.getElementById('exportGradesBtn')?.addEventListener('click', exportCSV)

  loadGrades()
}

// ── Pagination util ───────────────────────────────────────────
function renderPages(id, cur, total, onChange) {
  const el = document.getElementById(id)
  if (!el || total <= 1) { if (el) el.innerHTML = ''; return }
  let h = cur > 1 ? `<button class="page-btn" onclick="(${onChange})(${cur-1})">‹</button>` : ''
  for (let i = 1; i <= total; i++) {
    if (i === 1 || i === total || Math.abs(i-cur) <= 1)
      h += `<button class="page-btn${i===cur?' active':''}" onclick="(${onChange})(${i})">${i}</button>`
    else if (!h.endsWith('…'))
      h += `<button class="page-btn" disabled>…</button>`
  }
  if (cur < total) h += `<button class="page-btn" onclick="(${onChange})(${cur+1})">›</button>`
  el.innerHTML = h
}

// Expose CSS classes for bar styles
const styles = `
  .score-bar-wrap { flex:1; height:5px; background:var(--surface2); border-radius:99px; overflow:hidden; min-width:60px; }
  .score-bar      { height:100%; border-radius:99px; transition:width .6s ease; }
`
if (!document.getElementById('gradesStyles')) {
  const s = document.createElement('style')
  s.id = 'gradesStyles'
  s.textContent = styles
  document.head.appendChild(s)
}