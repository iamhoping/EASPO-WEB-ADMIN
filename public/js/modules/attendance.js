// /js/modules/attendance.js
import { supabase } from '../services/supabaseClient.js'
import { showToast } from '../ui/toast.js'

let allRecords  = []
let allStudents = []
let allSections = []
let filtered    = []
let currentPage = 1
const PER_PAGE  = 15
let currentStats = { total: 0, present: 0, absent: 0 }

const val   = id => (document.getElementById(id)?.value || '').trim()
const openM = id => document.getElementById(id)?.classList.remove('hidden')
const closeM= id => document.getElementById(id)?.classList.add('hidden')

const STATUS_PILL = {
	present : 'pill-green',
	absent  : 'pill-red',
	late    : 'pill-yellow',
	excused : 'pill-blue'
}

const BASE_STATUSES = ['present', 'late', 'absent']

// ── Fetch students for dropdowns ──────────────────────────────
async function fetchStudents() {
	try {
		const { data, error } = await supabase
			.from('profiles')
			.select('id, name, student_id, grade_level, section_id')
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

// Fetch and populate section filter
async function fetchSections() {
	try {
		const { data, error } = await supabase.from('sections').select('id,name').order('name', { ascending: true })
		if (error) {
			allSections = []
			return
		}
		allSections = data || []
		const el = document.getElementById('attSectionFilter')
		if (!el) return
		el.innerHTML = `<option value="">All Sections</option>` + allSections.map(s => `<option value="${s.id}">${s.name}</option>`).join('')
	} catch (e) {
		allSections = []
	}
}

// ── Fetch accurate counts ─────────────────────────────────────
async function fetchAccurateCounts(date) {
	try {
		const sectionFilter = document.getElementById('attSectionFilter')?.value || ''
		
		let presentQuery = supabase
			.from('attendance')
			.select('student_id', { count: 'exact', head: true })
			.eq('attendance_date', date)
			.eq('status', 'present')
		
		// If section is selected, only count students from that section
		if (sectionFilter) {
			const studentsInSection = allStudents.filter(s => String(s.section_id) === sectionFilter).map(s => s.id)
			if (studentsInSection.length > 0) {
				presentQuery = presentQuery.in('student_id', studentsInSection)
			}
		}
		
		const { count: presentCount, error: presentError } = await presentQuery
		if (presentError) throw presentError
		
		// Calculate total based on section filter
		let totalStudents = allStudents.length
		if (sectionFilter) {
			totalStudents = allStudents.filter(s => String(s.section_id) === sectionFilter).length
		}
		
		const present = presentCount || 0
		const absent = Math.max(0, totalStudents - present)
		
		currentStats = { total: totalStudents, present, absent }
		return { total: totalStudents, present, absent }
	} catch (e) {
		console.error('Error fetching accurate counts:', e)
		return { total: 0, present: 0, absent: 0 }
	}
}

// ── Load ──────────────────────────────────────────────────────
export async function loadAttendance() {
	const tbody = document.getElementById('attendanceTableBody')
	if (tbody) tbody.innerHTML = `<tr><td colspan="7"><div class="loader"><div class="spinner"></div></div></td></tr>`

	await Promise.all([fetchStudents(), fetchSections()])
	populateStudentDropdown()

	const dateVal = document.getElementById('attendanceDatePicker')?.value || ''

	try {
		let q = supabase
			.from('attendance')
			.select('student_id, attendance_date, status, time_in, time_out')
			.order('attendance_date', { ascending: false })
		if (dateVal) q = q.eq('attendance_date', dateVal)
		const { data: attData, error: attError } = await q

		if (attError) {
			console.error('Attendance load error:', attError.message)
			allRecords = []
		} else {
			allRecords = (attData || []).map(rec => {
				if (rec.attendance_date && !rec.date) rec.date = rec.attendance_date
				if (rec.time_in && !rec.time) rec.time = rec.time_in
				else if (rec.time_out && !rec.time) rec.time = rec.time_out
				const student = allStudents.find(s => s.id === rec.student_id)
				return {
					...rec,
					student_name: student?.name || 'Unknown',
					student_id_code: student?.student_id || '—',
					grade_level: student?.grade_level || '—',
					section_id: student?.section_id || null,
					section_name: getSectionName(student?.section_id)
					
				}
			})
		}
		populateStatusFilter()
		console.log(`Loaded ${allRecords.length} attendance records for ${dateVal}`)
	} catch (error) {
		console.error('Exception in loadAttendance:', error)
		allRecords = []
	}

	// Fetch accurate DB-backed counts
	const summaryDate = dateVal || new Date().toISOString().slice(0,10)
	try {
		const counts = await fetchAccurateCounts(summaryDate)
		setText('attTotal', counts.total)
		setText('attPresent', counts.present)
		setText('attAbsent', counts.absent)
		const pct = counts.total > 0 ? Math.round((counts.present / counts.total) * 100) : 0
		setText('presentPercent', pct + '%')
	} catch (e) {
		console.error('Error updating stats:', e)
	}

	applyFilters()
}

// ── Get section name from section_id ──────────────────────────
function getSectionName(sectionId) {
	if (!sectionId) return '—'
	const section = allSections.find(item => String(item.id) === String(sectionId))
	return section?.name || '—'
}

// ── Mini stats ────────────────────────────────────────────────
function updateAttendanceMiniStats() {
	// Use cached stats that were fetched from DB
	setText('attTotal', currentStats.total)
	setText('attPresent', currentStats.present)
	setText('attAbsent', currentStats.absent)
	
	const pct = currentStats.total > 0 ? Math.round((currentStats.present / currentStats.total) * 100) : 0
	setText('presentPercent', pct + '%')
	setText('absentToday', currentStats.absent)
	setText('lateToday', 0)
}

// ── Filter ────────────────────────────────────────────────────
export function applyFilters() {
	const q   = val('attendanceSearch').toLowerCase()
	const gr  = document.getElementById('attGradeFilter')?.value   || ''
	const sec = document.getElementById('attSectionFilter')?.value || ''
	const st  = document.getElementById('attStatusFilter')?.value  || ''

	filtered = allRecords.filter(r => {
		const name  = r.student_name || ''
		const grade = r.grade_level || ''
		const sid   = r.student_id_code || ''
		const sectionId = String(r.section_id || '')
		return (
			(!q  || name.toLowerCase().includes(q) || sid.toLowerCase().includes(q)) &&
			(!gr || grade === gr) &&
			(!sec || sectionId === String(sec)) &&
			(!st || String(r.status || '').toLowerCase() === String(st).toLowerCase())
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
			<tr><td colspan="7">
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

	const pages = Math.max(1, Math.ceil(total / PER_PAGE))
	const start = (currentPage - 1) * PER_PAGE
	const pageItems = filtered.slice(start, start + PER_PAGE)

	tbody.innerHTML = pageItems.map(r => {
		const name  = r.student_name || 'Unknown'
		const grade = r.grade_level || '—'
		const sid   = r.student_id_code || r.student_id || '—'
		const section = r.section_name || '—'
		const st    = (r.status || 'absent')
		const pillC = STATUS_PILL[st] || 'pill-grey'
		const pillL = st.charAt(0).toUpperCase() + st.slice(1)

		const dt = new Date(r.date)
		const dateStr = isNaN(dt) ? (r.date || '—') : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
		const rawTime = r.time || ''
		const timeStr = rawTime ? `<span class="time ${st==='present'?'text-green':'text-red'}">${rawTime}</span>` : '—'

		const safeName = String(name).replace(/'/g, "\\'")
		const studentId = r.student_id || ''

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
			<td><span class="pill pill-purple">${section}</span></td>
			<td>
				<span class="pill ${pillC} attendance-status-label">${pillL}</span>
			</td>
			<td>
				<div class="row-acts">
					<div class="attendance-status-edit">
						<button class="act-btn attendance-edit-btn" type="button" title="Edit status" aria-label="Edit attendance status for ${safeName}" aria-expanded="false">✏️</button>
						<div class="attendance-status-choices" aria-label="Choose attendance status for ${safeName}">
							<button class="attendance-status-choice present-choice" type="button" data-status="present" data-student-id="${studentId}" data-date="${r.attendance_date || r.date || ''}" data-previous-status="${st}">Present</button>
							<button class="attendance-status-choice absent-choice" type="button" data-status="absent" data-student-id="${studentId}" data-date="${r.attendance_date || r.date || ''}" data-previous-status="${st}">Absent</button>
						</div>
					</div>
					<button class="act-btn danger" title="Delete" onclick="confirmDeleteAttendance('${studentId}','${r.date}','${safeName}')">🗑</button>
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

	const { data: existing } = await supabase
		.from('attendance')
		.select('student_id, attendance_date')
		.eq('student_id', student_id)
		.eq('attendance_date', date)
		.maybeSingle()

	if (existing) {
		const { error } = await supabase
			.from('attendance')
			.update({ status })
			.eq('student_id', student_id)
			.eq('attendance_date', date)
		if (error) return showToast('Error', error.message, 'error')
		showToast('Updated', 'Attendance record updated', 'success')
	} else {
		const { error } = await supabase
			.from('attendance')
			.insert([{ student_id, status, attendance_date: date }])
		if (error) return showToast('Error', error.message, 'error')
		showToast('Recorded', 'Attendance entry saved', 'success')
	}

	closeM('manualEntryModal')
	document.getElementById('manualEntryForm')?.reset()
	loadAttendance()
}

// ── Edit attendance status ────────────────────────────────────
function closeAttendanceEditor(editor) {
	if (!editor) return
	editor.classList.remove('open')
	editor.querySelector('.attendance-edit-btn')?.setAttribute('aria-expanded', 'false')
}

window.changeAttendanceStatus = async function(choice) {
	const studentId = choice.dataset.studentId
	const date = choice.dataset.date
	const previousStatus = choice.dataset.previousStatus || 'absent'
	const nextStatus = choice.dataset.status?.toLowerCase()
	if (!studentId || !date || !['present', 'absent'].includes(nextStatus)) return

	const editor = choice.closest('.attendance-status-edit')
	editor?.querySelectorAll('.attendance-status-choice').forEach(button => { button.disabled = true })
	const { error } = await supabase
		.from('attendance')
		.update({ status: nextStatus })
		.eq('student_id', studentId)
		.eq('attendance_date', date)

	if (error) {
		editor?.querySelectorAll('.attendance-status-choice').forEach(button => { button.disabled = false })
		closeAttendanceEditor(editor)
		return showToast('Update failed', error.message, 'error')
	}

	const record = allRecords.find(item => String(item.student_id) === String(studentId) && String(item.attendance_date || item.date) === String(date))
	if (record) record.status = nextStatus
	closeAttendanceEditor(editor)
	showToast('Attendance updated', `Status set to ${nextStatus.charAt(0).toUpperCase() + nextStatus.slice(1)}.`, 'success')
	applyFilters()
}

// ── Delete attendance record ──────────────────────────────────
window.confirmDeleteAttendance = function(studentId, date, name) {
	if (!confirm(`Delete attendance record for "${name}"?`)) return
	supabase.from('attendance')
		.delete()
		.eq('student_id', studentId)
		.eq('attendance_date', date)
		.then(({ error }) => {
			if (error) return showToast('Error', error.message, 'error')
			showToast('Deleted', 'Record removed', 'success')
			loadAttendance()
		})
}

// ── Bulk mark all students ────────────────────────────────────
export async function bulkMarkAttendance(status) {
	const date = document.getElementById('attendanceDatePicker')?.value || new Date().toISOString().slice(0,10)
	const sectionFilter = document.getElementById('attSectionFilter')?.value || ''
	
	// Filter students by section if selected
	const studentsToMark = sectionFilter 
		? allStudents.filter(s => String(s.section_id) === sectionFilter)
		: allStudents
	
	if (!Array.isArray(studentsToMark) || !studentsToMark.length) 
		return showToast('No students', 'No students to mark', 'warning')
	
	if (!confirm(`Mark ALL ${studentsToMark.length} students as "${status}" for ${date}?`)) return

	const rows = studentsToMark.map(s => ({
		student_id: s.id,
		status: status.toLowerCase(),
		attendance_date: date
	}))

	const { error } = await supabase.from('attendance').upsert(rows, { onConflict: 'student_id,attendance_date' })
	if (error) return showToast('Error', error.message, 'error')
	showToast('Done', `All students marked as ${status}`, 'success')
	loadAttendance()
}

// ── Export ────────────────────────────────────────────────────
function exportCSV() {
	if (!Array.isArray(allRecords) || !allRecords.length) return showToast('Empty', 'Nothing to export', 'warning')
	const headers = ['Date','Student Name','Student ID','Grade','Section','Status']
	const esc = v => `"${String(v ?? '').replace(/"/g,'""')}"`
	const rows = allRecords.map(rec => [
		esc(rec.date),
		esc(rec.student_name),
		esc(rec.student_id_code || rec.student_id),
		esc(rec.grade_level),
		esc(rec.section_name),
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
	const dp = document.getElementById('attendanceDatePicker')
	if (dp) {
		dp.addEventListener('change', loadAttendance)
	}

	document.getElementById('manualEntryBtn')?.addEventListener('click', () => {
		openM('manualEntryModal')
		const md = document.getElementById('manualDate')
		if (md) md.value = new Date().toISOString().slice(0,10)
	})

	document.getElementById('attendanceSearch')?.addEventListener('input', applyFilters)
	document.getElementById('attGradeFilter')?.addEventListener('change', applyFilters)
	document.getElementById('attSectionFilter')?.addEventListener('change', loadAttendance)
	document.getElementById('attStatusFilter')?.addEventListener('change', applyFilters)
	document.getElementById('exportAttendanceBtn')?.addEventListener('click', exportCSV)
	document.getElementById('attendanceTableBody')?.addEventListener('click', event => {
		const choice = event.target.closest('.attendance-status-choice')
		if (choice) {
			window.changeAttendanceStatus(choice)
			return
		}
		const editButton = event.target.closest('.attendance-edit-btn')
		if (!editButton) return
		const editor = editButton.closest('.attendance-status-edit')
		const isOpen = editor?.classList.toggle('open')
		editButton.setAttribute('aria-expanded', String(Boolean(isOpen)))
		if (isOpen) editor.querySelector('.attendance-status-choice')?.focus()
	})
	document.addEventListener('click', event => {
		if (!event.target.closest('.attendance-status-edit')) {
			document.querySelectorAll('.attendance-status-edit.open').forEach(closeAttendanceEditor)
		}
	})
	document.addEventListener('keydown', event => {
		if (event.key === 'Escape') {
			document.querySelectorAll('.attendance-status-edit.open').forEach(closeAttendanceEditor)
		}
	})

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
	const pages = []

	if (cur > 1) pages.push({ label: '‹', page: cur - 1 })

	for (let i = 1; i <= total; i++) {
		if (i === 1 || i === total || Math.abs(i - cur) <= 1) {
			pages.push({ label: i, page: i, active: i === cur })
		} else if (pages[pages.length - 1]?.label !== '…') {
			pages.push({ label: '…', page: null })
		}
	}

	if (cur < total) pages.push({ label: '›', page: cur + 1 })

	el.innerHTML = pages.map(p => `
		<button class="page-btn ${p.active ? 'active' : ''}" data-page="${p.page || ''}" ${p.page === null ? 'disabled' : ''}>
			${p.label}
		</button>
	`).join('')

	el.onclick = (e) => {
		const btn = e.target.closest('.page-btn')
		if (!btn) return
		const page = Number(btn.dataset.page)
		if (!isNaN(page) && page !== cur) onChange(page)
	}
}

function populateStatusFilter() {
	const filter = document.getElementById('attStatusFilter')
	if (!filter) return
	const current = filter.value
	const statuses = allRecords.some(record => String(record.status).toLowerCase() === 'excused')
		? [...BASE_STATUSES, 'excused']
		: BASE_STATUSES
	filter.innerHTML = '<option value="">All Statuses</option>' + statuses
		.map(status => `<option value="${status}">${status.charAt(0).toUpperCase() + status.slice(1)}</option>`)
		.join('')
	if (statuses.includes(current)) filter.value = current
}