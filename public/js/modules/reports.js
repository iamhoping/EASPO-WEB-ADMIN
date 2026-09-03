// /js/modules/reports.js
// Enhanced Reports & Analytics Module
// Simplified, performance-focused, with clear UX

import { supabase } from '../services/supabaseClient.js'
import { showToast } from '../ui/toast.js'

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

let chartInstances = {}
let activeReport = 'dashboard'
let reportData = emptyReportData()
let isInitialized = false

// Filter state - kept minimal
const filters = {
  gradeLevel: '',
  dateStart: '',
  dateEnd: ''
}

// Color palette for consistent charts
const CHART_COLORS = ['#2563EB', '#059669', '#D97706', '#7C3AED', '#DC2626', '#0891B2']

// ============================================================================
// REPORT DEFINITIONS - Simplified to essential reports only
// ============================================================================

const REPORTS = [
  { id: 'dashboard', label: 'Dashboard', icon: '📊' },
  { id: 'attendance', label: 'Attendance', icon: '📋' },
  { id: 'academic', label: 'Academic Performance', icon: '📈' },
  { id: 'enrollment', label: 'Enrollment', icon: '👥' }
]

// ============================================================================
// DATA STRUCTURE & INITIALIZATION
// ============================================================================

function emptyReportData() {
  return {
    students: [],
    teachers: [],
    sections: [],
    subjects: [],
    attendance: [],
    grades: [],
    enrollments: []
  }
}

export async function initReportsSection() {
  if (isInitialized) return
  
  renderReportsUI()
  attachEventListeners()
  await loadAndRenderReports()
  subscribeToChanges()
  
  isInitialized = true
}

// ============================================================================
// UI RENDERING - Clean, minimal, semantic HTML
// ============================================================================

function renderReportsUI() {
  const section = document.getElementById('reportsSection')
  if (!section || isInitialized) return

  section.innerHTML = `
    <div class="reports-container">
      <!-- Header with export buttons -->
      <div class="reports-header">
        <div class="reports-title">
          <h2>Reports & Analytics</h2>
          <p>View key metrics and performance data</p>
        </div>
        <div class="reports-actions">
          <button class="btn btn-secondary" id="exportExcelBtn" title="Download as Excel">
            Export Excel
          </button>
          <button class="btn btn-secondary" id="exportPdfBtn" title="Save as PDF">
            Save PDF
          </button>
        </div>
      </div>

      <!-- Report tabs -->
      <div class="reports-tabs" role="tablist">
        ${REPORTS.map(report => `
          <button 
            class="reports-tab" 
            role="tab"
            data-report="${report.id}"
            aria-selected="${report.id === activeReport}"
          >
            <span class="tab-icon">${report.icon}</span>
            <span class="tab-label">${report.label}</span>
          </button>
        `).join('')}
      </div>

      <!-- Filters -->
      <div class="reports-filters">
        <label class="filter-group">
          <span class="filter-label">Grade Level</span>
          <select id="gradeFilter" class="filter-input">
            <option value="">All Grades</option>
            <option value="Grade 7">Grade 7</option>
            <option value="Grade 8">Grade 8</option>
            <option value="Grade 9">Grade 9</option>
            <option value="Grade 10">Grade 10</option>
            <option value="Grade 11">Grade 11</option>
            <option value="Grade 12">Grade 12</option>
          </select>
        </label>

        <label class="filter-group">
          <span class="filter-label">From Date</span>
          <input type="date" id="dateStartFilter" class="filter-input">
        </label>

        <label class="filter-group">
          <span class="filter-label">To Date</span>
          <input type="date" id="dateEndFilter" class="filter-input">
        </label>

        <button class="btn btn-primary" id="applyFiltersBtn">Apply</button>
        <button class="btn btn-secondary" id="clearFiltersBtn">Clear</button>
      </div>

      <!-- Report content area -->
      <div id="reportContent" class="report-content"></div>
    </div>
  `

  injectStyles()
}

function attachEventListeners() {
  // Report navigation
  document.querySelectorAll('[data-report]').forEach(tab => {
    tab.addEventListener('click', () => {
      activeReport = tab.dataset.report
      updateReportDisplay()
    })
  })

  // Filter controls
  document.getElementById('applyFiltersBtn')?.addEventListener('click', () => {
    applyFilters()
    showToast('Success', 'Filters applied', 'success')
  })

  document.getElementById('clearFiltersBtn')?.addEventListener('click', () => {
    clearFilters()
    showToast('Success', 'Filters cleared', 'success')
  })

  // Export buttons
  document.getElementById('exportPdfBtn')?.addEventListener('click', () => {
    showToast('Info', 'Opening print dialog...', 'info')
    window.print()
  })

  document.getElementById('exportExcelBtn')?.addEventListener('click', exportAsExcel)
}

// ============================================================================
// DATA LOADING & FILTERING
// ============================================================================

async function loadAndRenderReports() {
  const content = document.getElementById('reportContent')
  if (content) content.innerHTML = '<div class="loading">Loading data...</div>'

  reportData = await fetchReportData()
  updateReportDisplay()
}

async function fetchReportData() {
  try {
    const [
      students,
      teachers,
      sections,
      subjects,
      attendance,
      grades,
      enrollments
    ] = await Promise.all([
      safeSelect('profiles', 'id,name,email,grade_level,status,role', q => q.eq('role', 'STUDENT')),
      safeSelect('profiles', 'id,name,email,department,status,role', q => q.eq('role', 'TEACHER')),
      safeSelect('sections', '*'),
      safeSelect('subjects', '*'),
      safeSelect('attendance', '*, student:student_id(name,grade_level)', q => q.order('attendance_date', { ascending: false })),
      safeSelect('grades', '*, student:student_id(name,grade_level)', q => q.order('created_at', { ascending: false })),
      safeSelect('enrollments', '*')
    ])

    // Normalize attendance dates
    const normalizedAttendance = (attendance || []).map(r => ({
      ...r,
      date: r.attendance_date || r.date
    }))

    return {
      students: students || [],
      teachers: teachers || [],
      sections: sections || [],
      subjects: subjects || [],
      attendance: normalizedAttendance || [],
      grades: grades || [],
      enrollments: enrollments || []
    }
  } catch (error) {
    console.error('Error fetching report data:', error)
    showToast('Error', 'Failed to load reports', 'error')
    return emptyReportData()
  }
}

async function safeSelect(table, columns = '*', queryFn) {
  try {
    let query = supabase.from(table).select(columns)
    if (queryFn) query = queryFn(query)
    const { data, error } = await query
    if (error) throw error
    return data || []
  } catch (error) {
    console.warn(`Failed to fetch ${table}:`, error.message)
    return []
  }
}

function applyFilters() {
  filters.gradeLevel = document.getElementById('gradeFilter')?.value || ''
  filters.dateStart = document.getElementById('dateStartFilter')?.value || ''
  filters.dateEnd = document.getElementById('dateEndFilter')?.value || ''
  updateReportDisplay()
}

function clearFilters() {
  filters.gradeLevel = ''
  filters.dateStart = ''
  filters.dateEnd = ''
  document.getElementById('gradeFilter').value = ''
  document.getElementById('dateStartFilter').value = ''
  document.getElementById('dateEndFilter').value = ''
  updateReportDisplay()
}

// ============================================================================
// FILTERED DATA HELPERS - Simple, reusable
// ============================================================================

function getFilteredStudents() {
  return reportData.students.filter(s => 
    !filters.gradeLevel || s.grade_level === filters.gradeLevel
  )
}

function getFilteredAttendance() {
  return reportData.attendance.filter(a => {
    const gradeMatch = !filters.gradeLevel || a.student?.grade_level === filters.gradeLevel
    const dateMatch = isInDateRange(a.date)
    return gradeMatch && dateMatch
  })
}

function getFilteredGrades() {
  return reportData.grades.filter(g => {
    const gradeMatch = !filters.gradeLevel || g.student?.grade_level === filters.gradeLevel
    const dateMatch = isInDateRange(g.created_at)
    return gradeMatch && dateMatch
  })
}

function getFilteredEnrollments() {
  return reportData.enrollments.filter(e => 
    isInDateRange(e.created_at)
  )
}

function isInDateRange(dateStr) {
  if (!dateStr || (!filters.dateStart && !filters.dateEnd)) return true
  const date = String(dateStr).slice(0, 10)
  return (!filters.dateStart || date >= filters.dateStart) && 
         (!filters.dateEnd || date <= filters.dateEnd)
}

// ============================================================================
// REPORT RENDERING - One function per report type
// ============================================================================

function updateReportDisplay() {
  clearAllCharts()
  updateTabIndicators()

  const content = document.getElementById('reportContent')
  if (!content) return

  const renderFunctions = {
    dashboard: renderDashboard,
    attendance: renderAttendanceReport,
    academic: renderAcademicReport,
    enrollment: renderEnrollmentReport
  }

  const html = renderFunctions[activeReport]?.() || renderDashboard()
  content.innerHTML = html
  
  // Render charts after DOM updates
  requestAnimationFrame(renderChartsForCurrentReport)
}

function updateTabIndicators() {
  document.querySelectorAll('[data-report]').forEach(tab => {
    tab.setAttribute('aria-selected', tab.dataset.report === activeReport)
    tab.classList.toggle('active', tab.dataset.report === activeReport)
  })
}

// ============================================================================
// DASHBOARD REPORT
// ============================================================================

function renderDashboard() {
  const students = getFilteredStudents()
  const teachers = reportData.teachers
  const attendance = getFilteredAttendance()
  const grades = getFilteredGrades()

  const presentToday = attendance.filter(a => isToday(a.date) && normalize(a.status) === 'present').length
  const avgGrade = calculateAverage(grades.map(g => Number(g.score || 0)))

  return `
    <div class="report">
      <h3>Dashboard</h3>
      <p class="report-subtitle">Overview of key metrics and statistics</p>

      ${renderStatCards([
        ['Students', students.length],
        ['Teachers', teachers.length],
        ['Present Today', presentToday],
        ['Avg Grade', avgGrade.toFixed(1)],
        ['Attendance Records', attendance.length],
        ['Sections', reportData.sections.length]
      ])}

      ${renderChartGrid([
        ['Students per Grade', 'dashStudentsByGrade'],
        ['Attendance Status', 'dashAttendanceStatus'],
        ['Grade Distribution', 'dashGradeDistribution'],
        ['Enrollment Trend', 'dashEnrollmentTrend']
      ])}

      ${renderDataTable('Recent Grades', 
        ['Student', 'Subject', 'Score', 'Date'],
        grades.slice(0, 10).map(g => [
          g.student?.name || 'Unknown',
          g.subject || '-',
          g.score || '-',
          formatDate(g.created_at)
        ])
      )}
    </div>
  `
}

// ============================================================================
// ATTENDANCE REPORT
// ============================================================================

function renderAttendanceReport() {
  const attendance = getFilteredAttendance()
  const present = attendance.filter(a => normalize(a.status) === 'present').length
  const absent = attendance.length - present

  const byStudent = groupBy(attendance, a => a.student?.name || 'Unknown')
  const topAbsentees = Object.entries(byStudent)
    .map(([name, records]) => [name, records.filter(a => normalize(a.status) !== 'present').length])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)

  return `
    <div class="report">
      <h3>Attendance Reports</h3>
      <p class="report-subtitle">Daily and student attendance monitoring</p>

      ${renderStatCards([
        ['Total Records', attendance.length],
        ['Present', present],
        ['Absent', absent],
        ['Attendance Rate', attendance.length ? ((present / attendance.length) * 100).toFixed(1) + '%' : '-']
      ])}

      ${renderChartGrid([
        ['Present vs Absent', 'attPresent'],
        ['Attendance Trend', 'attTrend']
      ])}

      ${renderDataTable('Top Absent Students',
        ['Student', 'Absences'],
        topAbsentees
      )}
    </div>
  `
}

// ============================================================================
// ACADEMIC REPORT
// ============================================================================

function renderAcademicReport() {
  const grades = getFilteredGrades()
  const scores = grades.map(g => Number(g.score || 0)).filter(s => Number.isFinite(s))
  const passed = scores.filter(s => s >= 75).length
  const failed = scores.filter(s => s < 75).length

  const topPerformers = [...grades]
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0, 10)

  return `
    <div class="report">
      <h3>Academic Performance</h3>
      <p class="report-subtitle">Student grades and performance metrics</p>

      ${renderStatCards([
        ['Total Grades', grades.length],
        ['Passed', passed],
        ['Failed', failed],
        ['Average Score', scores.length ? calculateAverage(scores).toFixed(1) : '-'],
        ['Highest Score', scores.length ? Math.max(...scores) : '-'],
        ['Lowest Score', scores.length ? Math.min(...scores) : '-']
      ])}

      ${renderChartGrid([
        ['Subject Averages', 'acadSubjectAvg'],
        ['Passed vs Failed', 'acadPassFail'],
        ['Score Distribution', 'acadDistribution']
      ])}

      ${renderDataTable('Top Performing Students',
        ['Student', 'Subject', 'Score'],
        topPerformers.map(g => [
          g.student?.name || 'Unknown',
          g.subject || '-',
          g.score || '-'
        ])
      )}
    </div>
  `
}

// ============================================================================
// ENROLLMENT REPORT
// ============================================================================

function renderEnrollmentReport() {
  const enrollments = getFilteredEnrollments()
  const byGrade = groupBy(enrollments, e => e.grade_level || 'Unassigned')

  return `
    <div class="report">
      <h3>Enrollment</h3>
      <p class="report-subtitle">Student enrollment trends and distribution</p>

      ${renderStatCards([
        ['Total Enrolled', enrollments.length],
        ['This Month', countThisMonth(enrollments, 'created_at')],
        ['Grade Levels', Object.keys(byGrade).length]
      ])}

      ${renderChartGrid([
        ['Enrollment Trend', 'enrollTrend'],
        ['By Grade Level', 'enrollByGrade']
      ])}

      ${renderDataTable('Enrollment by Grade',
        ['Grade Level', 'Students'],
        Object.entries(byGrade).map(([grade, records]) => [grade, records.length])
      )}
    </div>
  `
}

// ============================================================================
// CHART RENDERING
// ============================================================================

function renderChartsForCurrentReport() {
  const renderers = {
    dashboard: () => {
      barChart('dashStudentsByGrade', 'Students', groupBy(getFilteredStudents(), s => s.grade_level || 'Unassigned'))
      doughnutChart('dashAttendanceStatus', countAttendanceStatus(getFilteredAttendance()))
      barChart('dashGradeDistribution', 'Students', getGradeDistribution(getFilteredGrades()))
      lineChart('dashEnrollmentTrend', 'Enrollments', getMonthlyCounts(getFilteredEnrollments(), 'created_at'))
    },
    attendance: () => {
      doughnutChart('attPresent', countAttendanceStatus(getFilteredAttendance()))
      lineChart('attTrend', 'Records', getDailyCounts(getFilteredAttendance(), 'date'))
    },
    academic: () => {
      barChart('acadSubjectAvg', 'Avg Score', getSubjectAverages(getFilteredGrades()))
      doughnutChart('acadPassFail', countPassFail(getFilteredGrades()))
      barChart('acadDistribution', 'Students', getGradeDistribution(getFilteredGrades()))
    },
    enrollment: () => {
      lineChart('enrollTrend', 'Enrollments', getMonthlyCounts(getFilteredEnrollments(), 'created_at'))
      barChart('enrollByGrade', 'Students', groupBy(getFilteredEnrollments(), e => e.grade_level || 'Unassigned'))
    }
  }

  renderers[activeReport]?.()
}

function createChart(canvasId, type, data, options = {}) {
  const canvas = document.getElementById(canvasId)
  if (!canvas || typeof Chart === 'undefined') return

  destroyChart(canvasId)
  
  chartInstances[canvasId] = new Chart(canvas, {
    type,
    data,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom' } },
      scales: (type === 'doughnut' || type === 'pie') ? undefined : { y: { beginAtZero: true } },
      ...options
    }
  })
}

function destroyChart(chartId) {
  if (chartInstances[chartId]) {
    chartInstances[chartId].destroy()
    delete chartInstances[chartId]
  }
}

function clearAllCharts() {
  Object.keys(chartInstances).forEach(destroyChart)
}

function barChart(id, label, data) {
  const keys = Object.keys(data)
  createChart(id, 'bar', {
    labels: keys.length ? keys : ['No data'],
    datasets: [{
      label,
      data: keys.length ? Object.values(data) : [0],
      backgroundColor: CHART_COLORS,
      borderRadius: 6
    }]
  }, { plugins: { legend: { display: false } } })
}

function lineChart(id, label, data) {
  const keys = Object.keys(data)
  createChart(id, 'line', {
    labels: keys.length ? keys : ['No data'],
    datasets: [{
      label,
      data: keys.length ? Object.values(data) : [0],
      borderColor: '#2563EB',
      backgroundColor: 'rgba(37, 99, 235, 0.1)',
      fill: true,
      tension: 0.35
    }]
  })
}

function doughnutChart(id, data) {
  const keys = Object.keys(data)
  createChart(id, 'doughnut', {
    labels: keys.length ? keys : ['No data'],
    datasets: [{
      data: keys.length ? Object.values(data) : [0],
      backgroundColor: CHART_COLORS
    }]
  })
}

// ============================================================================
// UI HELPER COMPONENTS
// ============================================================================

function renderStatCards(stats) {
  return `
    <div class="stats-grid">
      ${stats.map(([label, value]) => `
        <div class="stat-card">
          <div class="stat-value">${escapeHtml(value)}</div>
          <div class="stat-label">${label}</div>
        </div>
      `).join('')}
    </div>
  `
}

function renderChartGrid(charts) {
  return `
    <div class="charts-grid">
      ${charts.map(([title, id]) => `
        <div class="chart-card">
          <h4>${title}</h4>
          <canvas id="${id}"></canvas>
        </div>
      `).join('')}
    </div>
  `
}

function renderDataTable(title, headers, rows) {
  return `
    <div class="data-table">
      <h4>${title}</h4>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr>
          </thead>
          <tbody>
            ${rows.length 
              ? rows.map(row => `<tr>${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')
              : `<tr><td colspan="${headers.length}" class="no-data">No records found</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>
  `
}

// ============================================================================
// DATA AGGREGATION HELPERS
// ============================================================================

function groupBy(arr, keyFn) {
  return arr.reduce((acc, item) => {
    const key = String(keyFn(item) || 'Unassigned')
    if (!acc[key]) acc[key] = []
    acc[key].push(item)
    return acc
  }, {})
}

function countAttendanceStatus(attendance) {
  return {
    Present: attendance.filter(a => normalize(a.status) === 'present').length,
    Absent: attendance.filter(a => normalize(a.status) !== 'present').length
  }
}

function countPassFail(grades) {
  return {
    Passed: grades.filter(g => Number(g.score || 0) >= 75).length,
    Failed: grades.filter(g => Number(g.score || 0) < 75).length
  }
}

function getGradeDistribution(grades) {
  const dist = { 'A (90+)': 0, 'B (80-89)': 0, 'C (75-79)': 0, 'Below 75': 0 }
  grades.forEach(g => {
    const score = Number(g.score || 0)
    if (score >= 90) dist['A (90+)']++
    else if (score >= 80) dist['B (80-89)']++
    else if (score >= 75) dist['C (75-79)']++
    else dist['Below 75']++
  })
  return dist
}

function getSubjectAverages(grades) {
  const groups = {}
  grades.forEach(g => {
    const subject = g.subject || 'Unassigned'
    if (!groups[subject]) groups[subject] = []
    groups[subject].push(Number(g.score || 0))
  })
  return Object.fromEntries(
    Object.entries(groups).map(([subject, scores]) => [subject, calculateAverage(scores)])
  )
}

function getDailyCounts(arr, dateField) {
  return groupBy(arr, item => formatDate(item[dateField])).reduce((acc, item) => {
    Object.entries(item).forEach(([date]) => {
      acc[date] = (acc[date] || 0) + 1
    })
    return acc
  }, {})
}

function getMonthlyCounts(arr, dateField) {
  const counts = {}
  arr.forEach(item => {
    const date = item[dateField] ? new Date(item[dateField]) : null
    if (date && !isNaN(date)) {
      const key = date.toLocaleString('default', { month: 'short', year: '2-digit' })
      counts[key] = (counts[key] || 0) + 1
    }
  })
  return counts
}

function countThisMonth(arr, dateField) {
  const now = new Date()
  return arr.filter(item => {
    const date = item[dateField] ? new Date(item[dateField]) : null
    return date && date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear()
  }).length
}

function calculateAverage(values) {
  const nums = values.filter(Number.isFinite)
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0
}

function isToday(dateStr) {
  const today = new Date().toISOString().slice(0, 10)
  return String(dateStr).slice(0, 10) === today
}

// ============================================================================
// EXPORT FUNCTIONALITY
// ============================================================================

async function exportAsExcel() {
  const rows = buildExportData()
  
  if (window.XLSX) {
    const ws = XLSX.utils.aoa_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Reports')
    XLSX.writeFile(wb, `reports-${new Date().toISOString().slice(0, 10)}.xlsx`)
  } else {
    const csv = rows.map(row => row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    downloadBlob(csv, `reports-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8')
  }
  
  showToast('Success', 'Report exported', 'success')
}

function buildExportData() {
  const attendance = getFilteredAttendance()
  const grades = getFilteredGrades()

  return [
    ['EASPO Reports'],
    ['Generated', new Date().toLocaleString()],
    ['Report', REPORTS.find(r => r.id === activeReport)?.label || 'Reports'],
    [],
    ['Summary Statistics'],
    ['Total Students', getFilteredStudents().length],
    ['Total Teachers', reportData.teachers.length],
    ['Total Sections', reportData.sections.length],
    ['Attendance Records', attendance.length],
    ['Grade Records', grades.length],
    [],
    ['Attendance Data'],
    ['Date', 'Student', 'Status', 'Subject'],
    ...attendance.slice(0, 100).map(a => [formatDate(a.date), a.student?.name || '', a.status || '', a.subject || '']),
    [],
    ['Grades Data'],
    ['Student', 'Subject', 'Score', 'Date'],
    ...grades.slice(0, 100).map(g => [g.student?.name || '', g.subject || '', g.score || '', formatDate(g.created_at)])
  ]
}

function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

// ============================================================================
// UTILITIES & HELPERS
// ============================================================================

function formatDate(dateStr) {
  if (!dateStr) return '-'
  return String(dateStr).slice(0, 10)
}

function normalize(value) {
  return String(value || '').trim().toLowerCase()
}

function escapeHtml(value) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
  return String(value ?? '').replace(/[&<>"']/g, char => map[char])
}

function subscribeToChanges() {
  supabase.channel('reports-updates')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, loadAndRenderReports)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'grades' }, loadAndRenderReports)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'enrollments' }, loadAndRenderReports)
    .subscribe()
}

// ============================================================================
// STYLES
// ============================================================================

function injectStyles() {
  if (document.getElementById('reportsStyles')) return

  const styles = document.createElement('style')
  styles.id = 'reportsStyles'
  styles.textContent = `
    /* Container & Layout */
    .reports-container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 0;
    }

    /* Header */
    .reports-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 28px;
      gap: 20px;
    }

    .reports-title h2 {
      font-size: 1.8rem;
      margin: 0 0 4px;
      color: var(--text);
    }

    .reports-title p {
      margin: 0;
      color: var(--text2);
      font-size: 0.95rem;
    }

    .reports-actions {
      display: flex;
      gap: 12px;
    }

    /* Tabs */
    .reports-tabs {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 8px;
      margin-bottom: 28px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--border);
    }

    .reports-tab {
      padding: 12px 16px;
      background: transparent;
      border: 2px solid transparent;
      border-radius: 8px;
      cursor: pointer;
      color: var(--text2);
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
      transition: all 0.2s ease;
    }

    .reports-tab:hover {
      background: var(--surface);
      color: var(--text);
    }

    .reports-tab[aria-selected="true"],
    .reports-tab.active {
      border-color: var(--primary);
      color: var(--primary);
      background: var(--primary-dim);
    }

    .tab-icon {
      font-size: 1.2rem;
    }

    /* Filters */
    .reports-filters {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 12px;
      margin-bottom: 28px;
      padding: 16px;
      background: var(--surface);
      border-radius: 8px;
      align-items: end;
    }

    .filter-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .filter-label {
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--text2);
    }

    .filter-input {
      padding: 8px 12px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--bg);
      color: var(--text);
      font-size: 0.95rem;
    }

    /* Report Content */
    .report-content {
      min-height: 400px;
    }

    .report {
      display: flex;
      flex-direction: column;
      gap: 24px;
    }

    .report h3 {
      font-size: 1.5rem;
      margin: 0;
      color: var(--text);
    }

    .report-subtitle {
      margin: -20px 0 0;
      color: var(--text2);
      font-size: 0.95rem;
    }

    .loading {
      text-align: center;
      padding: 60px 20px;
      color: var(--text2);
    }

    /* Stats Grid */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 16px;
    }

    .stat-card {
      padding: 20px;
      background: var(--surface);
      border-radius: 8px;
      border: 1px solid var(--border);
    }

    .stat-value {
      font-size: 1.8rem;
      font-weight: 700;
      color: var(--primary);
      margin-bottom: 8px;
    }

    .stat-label {
      font-size: 0.85rem;
      color: var(--text2);
      font-weight: 600;
    }

    /* Charts Grid */
    .charts-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 20px;
    }

    .chart-card {
      padding: 20px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      min-height: 350px;
    }

    .chart-card h4 {
      margin: 0 0 16px;
      font-size: 1rem;
      color: var(--text);
    }

    .chart-card canvas {
      max-height: 280px;
    }

    /* Data Tables */
    .data-table {
      margin-top: 24px;
    }

    .data-table h4 {
      margin: 0 0 12px;
      font-size: 1rem;
      color: var(--text);
    }

    .table-wrapper {
      overflow-x: auto;
      border-radius: 8px;
      border: 1px solid var(--border);
    }

    .data-table table {
      width: 100%;
      border-collapse: collapse;
      background: var(--surface);
    }

    .data-table th {
      padding: 12px 16px;
      text-align: left;
      font-weight: 600;
      color: var(--text2);
      font-size: 0.85rem;
      border-bottom: 1px solid var(--border);
      background: var(--bg);
    }

    .data-table td {
      padding: 12px 16px;
      border-bottom: 1px solid var(--border);
      font-size: 0.95rem;
      color: var(--text);
    }

    .data-table tr:last-child td {
      border-bottom: none;
    }

    .data-table .no-data {
      text-align: center;
      color: var(--text2);
      padding: 20px;
    }

    /* Responsive */
    @media (max-width: 768px) {
      .reports-header {
        flex-direction: column;
      }

      .reports-actions {
        width: 100%;
      }

      .reports-tabs {
        grid-template-columns: repeat(2, 1fr);
      }

      .reports-filters {
        grid-template-columns: 1fr;
      }

      .charts-grid {
        grid-template-columns: 1fr;
      }

      .stats-grid {
        grid-template-columns: repeat(2, 1fr);
      }
    }

    @media (max-width: 640px) {
      .reports-tabs {
        grid-template-columns: 1fr;
      }

      .stats-grid {
        grid-template-columns: 1fr;
      }

      .report h3 {
        font-size: 1.3rem;
      }
    }

    /* Print Styles */
    @media print {
      .reports-header,
      .reports-tabs,
      .reports-filters,
      .page-header-actions {
        display: none !important;
      }

      .reports-container {
        max-width: 100%;
      }

      .chart-card,
      .data-table,
      .stat-card {
        break-inside: avoid;
        page-break-inside: avoid;
      }
    }
  `

  document.head.appendChild(styles)
}