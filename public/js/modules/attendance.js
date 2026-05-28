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
  const { data } = await supabase
    .from('profiles')
    .select('id,name,student_id,grade_level')
    .eq('role','STUDENT')
    .order('name',{ascending:true})
  allStudents = data || []
  populateStudentDropdown()
}

function populateStudentDropdown() {
  const el = document.getElementById('manualStudentSelect')
  if (!el) return
  el.innerHTML = `<option value="">Select student…</option>` +
    allStudents.map(s =>
      `<option value="${s.id}">${s.name} — ${s.grade_level||'N/A'} (${s.student_id||'—'})</option>`
    ).join('')
}

// ── Load ──────────────────────────────────────────────────────
export async function loadAttendance() {
  const tbody = document.getElementById('attendanceTableBody')
  if (tbody) tbody.innerHTML = `<tr><td colspan="6"><div class="loader"><div class="spinner"></div></div></td></tr>`

  await fetchStudents()

  const dateVal = document.getElementById('attendanceDatePicker')?.value || new Date().toISOString().slice(0,10)

  const { data, error } = await supabase
    .from('attendance')
    .select('*, profiles(name, student_id, grade_level)')
    .eq('date', dateVal)
    .order('created_at', { ascending: false })

  if (error) {
    console.warn('attendance load:', error.message)
    allRecords = []
  } else {
    allRecords = data || []
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

// ── Filter ────────────────────────────────────────────────────
export function applyFilters() {
  const q   = val('attendanceSearch').toLowerCase()
  const gr  = document.getElementById('attGradeFilter')?.value   || ''
  const st  = document.getElementById('attStatusFilter')?.value  || ''

  filtered = allRecords.filter(r => {
    const name  = r.profiles?.name        || ''
    const grade = r.profiles?.grade_level || ''
    const sid   = r.profiles?.student_id  || ''
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
    const name  = r.profiles?.name        || 'Unknown'
    const grade = r.profiles?.grade_level || '—'
    const sid   = r.profiles?.student_id  || '—'
    const st    = r.status || 'present'
    const pillC = STATUS_PILL[st] || 'pill-grey'
    const pillL = st.charAt(0).toUpperCase() + st.slice(1)

    const dt  = new Date(r.created_at || r.date)
    const dateStr = dt.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})
    const timeStr = r.created_at ? dt.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'}) : '—'

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
      <td style="font-size:.82rem;color:var(--text3)">${r.marked_by || 'System'}</td>
      <td><span class="pill ${pillC}">${pillL}</span></td>
      <td>
        <div class="row-acts">
          <button class="act-btn" title="Edit Status" onclick="openEditAttendanceModal('${r.id}','${st}','${name.replace(/'/g,"\\'")}')">✏️</button>
          <button class="act-btn danger" title="Delete" onclick="confirmDeleteAttendance('${r.id}','${name.replace(/'/g,"\\'")}')">🗑</button>
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
    .select('id')
    .eq('student_id', student_id)
    .eq('date', date)
    .maybeSingle()

  if (existing) {
    // Update existing record
    const { error } = await supabase
      .from('attendance')
      .update({ status, note: note||null, marked_by: 'Admin' })
      .eq('id', existing.id)
    if (error) return showToast('Error', error.message, 'error')
    showToast('Updated', 'Attendance record updated', 'success')
  } else {
    // Insert new record
    const { error } = await supabase
      .from('attendance')
      .insert([{ student_id, status, date, note: note||null, marked_by: 'Admin' }])
    if (error) return showToast('Error', error.message, 'error')
    showToast('Recorded', 'Attendance entry saved', 'success')
  }

  closeM('manualEntryModal')
  document.getElementById('manualEntryForm')?.reset()
  loadAttendance()
}

// ── Edit attendance status ────────────────────────────────────
window.openEditAttendanceModal = function(id, currentStatus, name) {
  const newStatus = prompt(
    `Change attendance for "${name}":\nEnter: present, absent, late, or excused`,
    currentStatus
  )
  if (!newStatus) return
  const valid = ['present','absent','late','excused']
  if (!valid.includes(newStatus.toLowerCase())) {
    showToast('Invalid','Enter: present, absent, late, or excused','warning'); return
  }
  supabase.from('attendance')
    .update({ status: newStatus.toLowerCase(), marked_by: 'Admin' })
    .eq('id', id)
    .then(({ error }) => {
      if (error) return showToast('Error', error.message, 'error')
      showToast('Updated', `Status set to ${newStatus}`, 'success')
      loadAttendance()
    })
}

// ── Delete ────────────────────────────────────────────────────
window.confirmDeleteAttendance = function(id, name) {
  if (!confirm(`Delete attendance record for "${name}"?`)) return
  supabase.from('attendance').delete().eq('id', id).then(({ error }) => {
    if (error) return showToast('Error', error.message, 'error')
    showToast('Deleted', 'Record removed', 'success')
    loadAttendance()
  })
}

// ── Bulk mark all students ────────────────────────────────────
export async function bulkMarkAttendance(status) {
  const date = document.getElementById('attendanceDatePicker')?.value || new Date().toISOString().slice(0,10)
  if (!allStudents.length) return showToast('No students', 'No students to mark', 'warning')
  if (!confirm(`Mark ALL ${allStudents.length} students as "${status}" for ${date}?`)) return

  const rows = allStudents.map(s => ({
    student_id : s.id,
    status,
    date,
    marked_by  : 'Admin (Bulk)',
  }))

  const { error } = await supabase.from('attendance').upsert(rows, { onConflict: 'student_id,date' })
  if (error) return showToast('Error', error.message, 'error')
  showToast('Done', `All students marked as ${status}`, 'success')
  loadAttendance()
}

// ── Export ────────────────────────────────────────────────────
function exportCSV() {
  if (!allRecords.length) return showToast('Empty', 'Nothing to export', 'warning')
  const h = ['Date','Student Name','Student ID','Grade','Status','Marked By']
  const r = allRecords.map(rec => [
    rec.date,
    rec.profiles?.name        || '',
    rec.profiles?.student_id  || '',
    rec.profiles?.grade_level || '',
    rec.status,
    rec.marked_by || 'System'
  ].map(x => `"${x||''}"`).join(','))
  const a = Object.assign(document.createElement('a'), {
    href     : URL.createObjectURL(new Blob([[h, ...r].join('\n')], { type: 'text/csv' })),
    download : `attendance-${new Date().toISOString().slice(0,10)}.csv`
  }); a.click()
}

// ── Init ──────────────────────────────────────────────────────
export function initAttendanceSection() {
  // Date picker default to today
  const dp = document.getElementById('attendanceDatePicker')
  if (dp) {
    dp.value = new Date().toISOString().slice(0,10)
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