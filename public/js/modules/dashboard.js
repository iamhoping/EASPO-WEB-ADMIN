import { supabase } from '../services/supabaseClient.js'
import { showToast } from '../ui/toast.js'
import { isSchoolDay, SCHOOL_YEAR_2025_2026 } from './school-calendar-2025-2026.js'

const dashboardCharts = {}
const DATA_PAGE_SIZE = 1000

async function fetchAllRows(buildQuery) {
  const rows = []
  for (let offset = 0; ; offset += DATA_PAGE_SIZE) {
    const { data, error } = await buildQuery(offset, offset + DATA_PAGE_SIZE - 1)
    if (error) return { data: null, error }
    rows.push(...(data || []))
    if (!data || data.length < DATA_PAGE_SIZE) return { data: rows, error: null }
  }
}

function getSchoolYearMonths() {
  const months = []
  const start = new Date(`${SCHOOL_YEAR_2025_2026.startDate}T00:00:00`)
  const end = new Date(`${SCHOOL_YEAR_2025_2026.endDate}T00:00:00`)
  for (let month = new Date(start.getFullYear(), start.getMonth(), 1); month <= end; month.setMonth(month.getMonth() + 1)) {
    months.push(new Date(month))
  }
  return months
}

function showChartMessage(canvasId, message) {
  const canvas = document.getElementById(canvasId)
  const emptyState = document.getElementById(canvasId.replace('Chart', 'Empty'))
  if (dashboardCharts[canvasId]) {
    dashboardCharts[canvasId].destroy()
    delete dashboardCharts[canvasId]
  }
  if (canvas) canvas.hidden = true
  if (emptyState) {
    emptyState.textContent = message
    emptyState.classList.remove('hidden')
  }
}

function renderDashboardChart(canvasId, type, data, options = {}) {
  const canvas = document.getElementById(canvasId)
  if (!canvas) return
  const emptyState = document.getElementById(canvasId.replace('Chart', 'Empty'))

  if (typeof globalThis.Chart === 'undefined') {
    showChartMessage(canvasId, 'Charts are unavailable. Check your connection and reload the dashboard.')
    console.error('Chart.js is unavailable; dashboard charts were not rendered.')
    return
  }

  if (dashboardCharts[canvasId]) dashboardCharts[canvasId].destroy()
  canvas.hidden = false
  emptyState?.classList.add('hidden')
  dashboardCharts[canvasId] = new globalThis.Chart(canvas, {
    type,
    data,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      ...options
    }
  })
}

function renderAttendanceTrend(rows) {
  const monthly = new Map()
  for (const row of rows) {
    const date = row.attendance_date
    if (!date || !isSchoolDay(date)) continue
    const monthKey = date.slice(0, 7)
    if (!monthly.has(monthKey)) monthly.set(monthKey, { total: 0, present: 0 })
    const month = monthly.get(monthKey)
    month.total++
    if (String(row.status || '').toLowerCase() === 'present') month.present++
  }

  const months = getSchoolYearMonths().map(date => {
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    const totals = monthly.get(key)
    return {
      label: date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
      rate: totals ? Math.round((totals.present / totals.total) * 100) : null
    }
  })

  if (!months.some(month => month.rate !== null)) {
    showChartMessage('dashboardAttendanceChart', 'No school-day attendance records are available for this school year.')
    return
  }

  renderDashboardChart('dashboardAttendanceChart', 'line', {
    labels: months.map(month => month.label),
    datasets: [{
      label: 'Attendance rate',
      data: months.map(month => month.rate),
      borderColor: '#16a34a',
      backgroundColor: 'rgba(22, 163, 74, .12)',
      fill: true,
      tension: .3
    }]
  }, {
    scales: { y: { beginAtZero: true, max: 100, ticks: { callback: value => `${value}%` } } },
    plugins: { legend: { display: false }, tooltip: { callbacks: { label: context => `${context.parsed.y}% of recorded attendance` } } }
  })
}

function renderGradeDistribution(rows) {
  const counts = new Map()
  for (const row of rows) {
    const grade = String(row.grade_level || '').trim() || 'Unassigned'
    counts.set(grade, (counts.get(grade) || 0) + 1)
  }
  const grades = [...counts.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
  if (!grades.length) {
    showChartMessage('dashboardGradeChart', 'No student profile records are available.')
    return
  }

  renderDashboardChart('dashboardGradeChart', 'bar', {
    labels: grades.map(([grade]) => grade),
    datasets: [{
      label: 'Students',
      data: grades.map(([, count]) => count),
      backgroundColor: '#0ea5e9',
      borderRadius: 5
    }]
  }, {
    indexAxis: 'y',
    scales: { x: { beginAtZero: true, ticks: { precision: 0 } } }
  })
}

export async function loadDashboard() {
  window.refreshChart = () => loadDashboard()
  const [
    studentsResult,
    { count: teacherCount, error: teacherError },
    { count: parentCount, error: parentError },
    { count: sectionCount, error: sectionError },
    attendanceResult
  ] = await Promise.all([
    fetchAllRows((from, to) => supabase.from('profiles')
      .select('id,grade_level')
      .eq('role', 'STUDENT')
      .or('status.is.null,status.neq.archived')
      .range(from, to)),
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'TEACHER').or('status.is.null,status.neq.archived'),
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'PARENT').or('status.is.null,status.neq.archived'),
    supabase.from('sections').select('id', { count: 'exact', head: true }),
    fetchAllRows((from, to) => supabase.from('attendance')
      .select('attendance_date,status')
      .gte('attendance_date', SCHOOL_YEAR_2025_2026.startDate)
      .lte('attendance_date', SCHOOL_YEAR_2025_2026.endDate)
      .order('attendance_date', { ascending: true })
      .range(from, to))
  ])

  setText('totalStudents', studentsResult.error ? '—' : studentsResult.data.length)
  setText('totalTeachers', teacherError ? '—' : teacherCount)
  setText('totalParents', parentError ? '—' : parentCount)
  setText('totalSections', sectionError ? '—' : sectionCount)

  const failedQueries = [
    studentsResult.error && `students: ${studentsResult.error.message}`,
    teacherError && `teachers: ${teacherError.message}`,
    parentError && `parents: ${parentError.message}`,
    sectionError && `sections: ${sectionError.message}`,
    attendanceResult.error && `attendance: ${attendanceResult.error.message}`
  ].filter(Boolean)

  if (failedQueries.length) {
    console.error('Dashboard data query failures:', failedQueries)
    showToast(`Some dashboard data could not be loaded: ${failedQueries.join('; ')}`, 'error')
  }

  if (studentsResult.error) showChartMessage('dashboardGradeChart', 'Student data could not be loaded.')
  else renderGradeDistribution(studentsResult.data)
  if (attendanceResult.error) showChartMessage('dashboardAttendanceChart', 'Attendance data could not be loaded.')
  else renderAttendanceTrend(attendanceResult.data)
}

export async function loadAdminProfile(userId) {
  const { data: { user } = {} } = await supabase.auth.getUser()
  const { data } = await supabase
    .from('profiles')
    .select('name, role')
    .eq('id', userId)
    .single()

  const name = data?.name || 'Admin'
  const ini = name.split(' ').map(word => word[0] || '').join('').slice(0, 2).toUpperCase()

  setText('sidebarName', name)
  setText('sidebarInitials', ini)
  setText('profileInitials', ini)
  setProfileAvatar(null, ini)

  const profileName = document.getElementById('profileName')
  const profileEmail = document.getElementById('profileEmail')
  if (profileName) profileName.value = name
  if (profileEmail) profileEmail.value = user?.email || ''
}

export function setProfileAvatar(url, initials = 'WA') {
  const targets = [document.getElementById('profileInitials'), document.getElementById('sidebarInitials')]
  targets.forEach(target => {
    if (!target) return
    target.textContent = ''
    if (url) {
      const image = document.createElement('img')
      image.src = url
      image.alt = 'Profile photo'
      image.onerror = () => { target.textContent = initials }
      target.appendChild(image)
    } else {
      target.textContent = initials
    }
  })
}

export function initOverviewSection() {
  // Calendar is initialized separately via initCalendar().
}

function setText(id, value) {
  const element = document.getElementById(id)
  if (element) element.textContent = value ?? '—'
}
