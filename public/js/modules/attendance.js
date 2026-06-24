// /js/modules/attendance.js
import { supabase } from '../services/supabaseClient.js'
import { showToast } from '../ui/toast.js'

let allRecords  = []
let allStudents = []
let filtered    = []
let currentPage = 1
const PER_PAGE  = 15

const val   = id => (document.getElementById(id)?.value || '').trim()
const openM = id => document.getElementById(id)?.classList.remove('hidden')
const closeM= id => document.getElementById(id)?.classList.add('hidden')

const STATUS_PILL = {
  present : 'pill-green',
  absent  : 'pill-red',
  late    : 'pill-yellow',
  excused : 'pill-blue',
}

// ── Fetch students for dropdowns ──────────────────────────────
async function fetchStudents() {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, name, student_id, grade_level')
      .eq('role', 'STUDENT')
      .order('name', { ascending: true })
    
    if (error) {
      console.error('Error fetching students:', error)
      allStudents = []
    } else {
      allStudents = data || []
    }
    populateStudentDropdown()
  } catch (error) {
    console.error('Exception in fetchStudents:', error)
    allStudents = []
  }
}

function populateStudentDropdown() {
  const el = document.getElementById('manualStudentSelect')
  if (!el) return
  el.innerHTML = `<option value="">Select student…</option>` +
    allStudents.map(s =>
      `<option value="${s.id}">${s.name} — ${s.grade_level || 'N/A'} (${s.student_id || '—'})</option>`
    ).join('')
}

// ── Load ──────────────────────────────────────────────────────
export async function loadAttendance() {
  const tbody = document.getElementById('attendanceTableBody')
  if (tbody) tbody.innerHTML = `<tr><td colspan="6"><div class="loader"><div class="spinner"></div></div></td></tr>`

  await fetchStudents()

  const dateVal = document.getElementById('attendanceDatePicker')?.value || ''

  try {
    // Fetch attendance records. If a date is selected, filter by it;
    // otherwise fetch all records ordered by date desc (default view).
    let q = supabase
      .from('attendance')
      .select('student_id, date, status, subject')
      .order('date', { ascending: false })
    if (dateVal) q = q.eq('date', dateVal)
    const { data: attData, error: attError } = await q

    if (attError) {
      console.error('Attendance load error:', attError.message)
      allRecords = []
    } else {
      // Enrich attendance records with student information
      allRecords = (attData || []).map(rec => {
        const student = allStudents.find(s => s.id === rec.student_id)
        return {
          ...rec,
          student_name: student?.name || 'Unknown',
          student_id_code: student?.student_id || '—',
          grade_level: student?.grade_level || '—',
          subject: rec.subject || '—'
        }
      })
    }
    console.log(`Loaded ${allRecords.length} attendance records for ${dateVal}`)
  } catch (error) {
    console.error('Exception in loadAttendance:', error)
    allRecords = []
  }

  updateAttendanceMiniStats()
  applyFilters()
}

// ── Mini stats ────────────────────────────────────────────────
function updateAttendanceMiniStats() {
  const total   = allStudents.length
  const present = allRecords.filter(r=>r.status==='present').length
  const absent  = allRecords.filter(r=>r.status==='absent').length
  const late    = allRecords.filter(r=>r.status==='late').length

  setText('attTotal',   total)
  setText('attPresent', present)
  setText('attAbsent',  absent)
  setText('attLate',    late)

  // Also update overview quick stats
  const pct = total > 0 ? Math.round((present/total)*100) : 0
  setText('presentPercent', pct+'%')
  setText('absentToday', absent)
  setText('lateToday',   late)
}

// ── Filter ────────────────────────────────────────────────
export function applyFilters() {
  const q   = val('attendanceSearch').toLowerCase()
  const gr  = document.getElementById('attGradeFilter')?.value   || ''
  const st  = document.getElementById('attStatusFilter')?.value  || ''

  filtered = allRecords.filter(r => {
    const name  = r.student_name || ''
    const grade = r.grade_level || ''
    const sid   = r.student_id_code || ''
    return (
      (!q  || name.toLowerCase().includes(q) || sid.toLowerCase().includes(q)) &&
      (!gr || grade === gr) &&
      (!st || r.status === st)
    )
  })
  currentPage = 1
  render()
}

// ── Render ────────────────────────────────────────────────────
function render() {
  const tbody   = document.getElementById('attendanceTableBody')
  const countEl = document.getElementById('attendanceCount')
  const total   = filtered.length
  if (!tbody) return

  if (!total) {
    tbody.innerHTML = `
      <tr><td colspan="6">
        <div class="empty-state">
          <div class="empty-icon">📋</div>
          <div class="empty-title">No attendance records</div>
          <div class="empty-sub">No records found for the selected date and filters.</div>
        </div>
      </td></tr>`
    if (countEl) countEl.textContent = '0 records'
    const pg = document.getElementById('attendancePagination')
    if (pg) pg.innerHTML = ''
    return
  }

  const start = (currentPage - 1) * PER_PAGE
  const slice = filtered.slice(start, start + PER_PAGE)
  const pages = Math.ceil(total / PER_PAGE)

  tbody.innerHTML = slice.map(r => {
    const name  = r.student_name || 'Unknown'
    const grade = r.grade_level || '—'
    const sid   = r.student_id_code || '—'
    const subject = r.subject || '—'
    const st    = r.status || 'present'
    const pillC = STATUS_PILL[st] || 'pill-grey'
    const pillL = st.charAt(0).toUpperCase() + st.slice(1)

    const dt  = new Date(r.date)
    const dateStr = dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    const timeStr = '—'

    return `
    <tr>
      <td class="time-cell">
        <span class="date">${dateStr}</span>
        <span class="time">${timeStr}</span>
      </td>
      <td>
        <div class="ent-row">
          <div>
            <div class="ent-name">${name}</div>
            <div class="ent-sub">${sid}</div>
          </div>
        </div>
      </td>
      <td><span class="pill pill-blue">${grade}</span></td>
      <td style="font-size:.82rem;color:var(--text3)">${subject}</td>
      <td><span class="pill ${pillC}">${pillL}</span></td>
      <td>
        <div class="row-acts">
          <button class="act-btn" title="Edit Status" onclick="openEditAttendanceModal('${r.student_id}','${st}','${name.replace(/'/g, "\\'")}')">✏️</button>
          <button class="act-btn danger" title="Delete" onclick="confirmDeleteAttendance('${r.student_id}','${r.date}','${name.replace(/'/g, "\\'")}')">🗑</button>
        </div>
      </td>
    </tr>`
  }).join('')

  if (countEl) countEl.textContent = `Showing ${start+1}–${Math.min(start+PER_PAGE,total)} of ${total} records`
  renderPages('attendancePagination', currentPage, pages, p => { currentPage = p; render() })
}

// ── Manual Entry ──────────────────────────────────────────────
export async function submitManualEntry() {
  const student_id = val('manualStudentSelect')
  const status     = val('manualStatus')
  const date       = val('manualDate') || new Date().toISOString().slice(0,10)
  const note       = val('manualNote')

  if (!student_id || !status)
    return showToast('Missing fields', 'Select a student and status', 'warning')

  // Check for duplicate
  const { data: existing } = await supabase
    .from('attendance')
    .select('student_id, date')
    .eq('student_id', student_id)
    .eq('date', date)
    .maybeSingle()

  if (existing) {
    // Update existing record
    const { error } = await supabase
      .from('attendance')
      .update({ status })
      .eq('student_id', student_id)
      .eq('date', date)
    if (error) return showToast('Error', error.message, 'error')
    showToast('Updated', 'Attendance record updated', 'success')
  } else {
    // Insert new record
    const { error } = await supabase
      .from('attendance')
      .insert([{ student_id, status, date }])
    if (error) return showToast('Error', error.message, 'error')
    showToast('Recorded', 'Attendance entry saved', 'success')
  }

  closeM('manualEntryModal')
  document.getElementById('manualEntryForm')?.reset()
  loadAttendance()
}
// ── Edit attendance status ────────────────────────────────────
window.openEditAttendanceModal = function(studentId, currentStatus, name) {
  const newStatus = prompt(
    `Change attendance for "${name}":\nEnter: present, absent, late, or excused`,
    currentStatus
  )
  if (!newStatus) return
  const valid = ['present','absent','late','excused']
  if (!valid.includes(newStatus.toLowerCase())) {
    showToast('Invalid','Enter: present, absent, late, or excused','warning'); return
  }
  const dateVal = document.getElementById('attendanceDatePicker')?.value || new Date().toISOString().slice(0,10)
  supabase.from('attendance')
    .update({ status: newStatus.toLowerCase() })
    .eq('student_id', studentId)
    .eq('date', dateVal)
    .then(({ error }) => {
      if (error) return showToast('Error', error.message, 'error')
      showToast('Updated', `Status set to ${newStatus}`, 'success')
      loadAttendance()
    })
}

// ── Delete attendance record ──────────────────────────────────
window.confirmDeleteAttendance = function(studentId, date, name) {
  if (!confirm(`Delete attendance record for "${name}"?`)) return
  supabase.from('attendance')
    .delete()
    .eq('student_id', studentId)
    .eq('date', date)
    .then(({ error }) => {
      if (error) return showToast('Error', error.message, 'error')
      showToast('Deleted', 'Record removed', 'success')
      loadAttendance()
    })
}

// ── Bulk mark all students ────────────────────────────────────
export async function bulkMarkAttendance(status) {
  const date = document.getElementById('attendanceDatePicker')?.value || new Date().toISOString().slice(0,10)
  if (!Array.isArray(allStudents) || !allStudents.length) return showToast('No students', 'No students to mark', 'warning')
  if (!confirm(`Mark ALL ${allStudents.length} students as "${status}" for ${date}?`)) return

  const rows = allStudents.map(s => ({
    student_id: s.id,
    status: status.toLowerCase(),
    date
  }))

  const { error } = await supabase.from('attendance').upsert(rows, { onConflict: 'student_id,date' })
  if (error) return showToast('Error', error.message, 'error')
  showToast('Done', `All students marked as ${status}`, 'success')
  loadAttendance()
}

// ── Export ────────────────────────────────────────────────────
function exportCSV() {
  if (!Array.isArray(allRecords) || !allRecords.length) return showToast('Empty', 'Nothing to export', 'warning')
  const headers = ['Date','Student Name','Student ID','Grade','Subject','Status']
  const esc = v => `"${String(v ?? '').replace(/"/g,'""')}"`
  const rows = allRecords.map(rec => [
    esc(rec.date),
    esc(rec.student_name),
    esc(rec.student_id_code || rec.student_id),
    esc(rec.grade_level),
    esc(rec.subject),
    esc(rec.status)
  ].join(','))
  const csv = [headers.join(','), ...rows].join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  a.download = `attendance-${new Date().toISOString().slice(0,10)}.csv`
  a.click()
}

// ── Init ──────────────────────────────────────────────────────
export function initAttendanceSection() {
  // Date picker (optional) — leave empty to show all records by default
  const dp = document.getElementById('attendanceDatePicker')
  if (dp) {
    dp.addEventListener('change', loadAttendance)
  }

  document.getElementById('manualEntryBtn')?.addEventListener('click', () => {
    openM('manualEntryModal')
    // Set default date on manual form
    const md = document.getElementById('manualDate')
    if (md) md.value = new Date().toISOString().slice(0,10)
  })

  document.getElementById('attendanceSearch')?.addEventListener('input', applyFilters)
  document.getElementById('attGradeFilter')?.addEventListener('change', applyFilters)
  document.getElementById('attStatusFilter')?.addEventListener('change', applyFilters)
  document.getElementById('exportAttendanceBtn')?.addEventListener('click', exportCSV)

  loadAttendance()
}

// ── Helpers ────────────────────────────────────────────────────
function setText(id, val) {
  const el = document.getElementById(id)
  if (el) el.textContent = val ?? '—'
}

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