// /js/modules/reports.js
// Reports & Analytics Module

import { supabase } from '../services/supabaseClient.js'
import { showToast } from '../ui/toast.js'
import { formatUserName } from '../utils/name-format.js'

let chartInstances = {}
let activeReport = 'overview'
let reportData = emptyReportData()
let hasRenderedShell = false
let hasSubscribed = false
let hasAttachedListeners = false
let printBranding = null
let reportSearchTimer = null

const filters = {
  query: '',
  gradeLevel: '',
  section: '',
  subject: '',
  teacher: '',
  startDate: '',
  endDate: ''
}

const REPORTS = [
  { id: 'overview', label: 'Dashboard Overview' },
  { id: 'attendance', label: 'Attendance Reports' },
  { id: 'academic', label: 'Academic Reports' },
  { id: 'enrollment', label: 'Enrollment Reports' },
  { id: 'teacher', label: 'Teacher Reports' },
  { id: 'section', label: 'Section Reports' },
  { id: 'subject', label: 'Subject Reports' },
]

const chartPalette = ['#2563EB', '#059669', '#D97706', '#7C3AED', '#DC2626', '#0891B2', '#DB2777', '#65A30D']

function emptyReportData() {
  return {
    students: [],
    teachers: [],
    parents: [],
    sections: [],
    subjects: [],
    enrollments: [],
    attendance: [],
    grades: [],
    schedules: []
  }
}

export async function initReportsSection() {
  renderReportsShell()
  attachReportListeners()
  await reloadReports()
  if (!hasSubscribed) subscribeToReportUpdates()
}

function renderReportsShell() {
  const section = document.getElementById('reportsSection')
  if (!section || hasRenderedShell) return

  section.innerHTML = `
    <div class="page-header">
      <div class="page-header-actions">
        <button class="btn btn-secondary" id="printReportBtn">Print</button>
        <button class="btn btn-secondary" id="exportPdfBtn">Export PDF</button>
        <button class="btn btn-secondary" id="exportExcelBtn">Excel</button>
        <button class="btn btn-primary" id="exportCsvBtn">CSV</button>
      </div>
    </div>

    <div class="reports-layout">
      <aside class="reports-nav" aria-label="Reports navigation">
        <div class="reports-nav-title">Reports</div>
        ${REPORTS.map(report => `
          <button class="reports-nav-btn" type="button" data-report-tab="${report.id}">
            ${report.label}
          </button>
        `).join('')}
      </aside>

      <div class="reports-main">
        <div class="panel report-filters-panel">
          <div class="reports-filter-grid">
            <label>
              <span>Search</span>
              <input id="reportSearch" type="search" class="filter-select" placeholder="Student, LRN, subject..." />
            </label>
            <label>
              <span>Grade Level</span>
              <select id="reportGradeFilter" class="filter-select">
                <option value="">All Grades</option>
                <option value="Grade 7">Grade 7</option>
                <option value="Grade 8">Grade 8</option>
                <option value="Grade 9">Grade 9</option>
                <option value="Grade 10">Grade 10</option>
                <option value="Grade 11">Grade 11</option>
                <option value="Grade 12">Grade 12</option>
              </select>
            </label>
            <label>
              <span>Section</span>
              <select id="reportSectionFilter" class="filter-select"></select>
            </label>
            <label>
              <span>Subject</span>
              <select id="reportSubjectFilter" class="filter-select"></select>
            </label>
            <label>
              <span>Teacher</span>
              <select id="reportTeacherFilter" class="filter-select"></select>
            </label>
            <label>
              <span>Start Date</span>
              <input type="date" id="reportStartDate" class="filter-select" />
            </label>
            <label>
              <span>End Date</span>
              <input type="date" id="reportEndDate" class="filter-select" />
            </label>
            <button class="btn btn-secondary btn-sm" id="reportRefreshBtn" type="button">Refresh</button>
          </div>
        </div>

        <div id="reportContent" class="report-content"></div>
      </div>
    </div>
  `

  injectReportStyles()
  hasRenderedShell = true
}

function attachReportListeners() {
  if (hasAttachedListeners) return
  hasAttachedListeners = true

  document.querySelectorAll('[data-report-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      activeReport = btn.dataset.reportTab
      renderActiveReport()
    })
  })

  document.getElementById('reportSearch')?.addEventListener('input', () => {
    clearTimeout(reportSearchTimer)
    reportSearchTimer = setTimeout(() => applyReportFilters(false), 200)
  })
  ;['reportStartDate', 'reportEndDate', 'reportGradeFilter', 'reportSectionFilter', 'reportSubjectFilter', 'reportTeacherFilter']
    .forEach(id => document.getElementById(id)?.addEventListener('change', applyReportFilters))

  document.getElementById('reportRefreshBtn')?.addEventListener('click', reloadReports)
  document.getElementById('printReportBtn')?.addEventListener('click', printCurrentReport)
  document.getElementById('exportPdfBtn')?.addEventListener('click', exportReportAsPDF)
  document.getElementById('exportCsvBtn')?.addEventListener('click', exportReportAsCSV)
  document.getElementById('exportExcelBtn')?.addEventListener('click', exportReportAsExcel)

  window.applyReportFilters = applyReportFilters
  window.printReport = printCurrentReport
  window.exportReportPdf = exportReportAsPDF
  window.exportReportCsv = exportReportAsCSV
  window.exportReportAsPDF = exportReportAsPDF
  window.exportReportAsCSV = exportReportAsCSV
  window.exportReportAsExcel = exportReportAsExcel

  window.addEventListener('sectionChange', event => {
    if (event.detail?.section === 'reports') renderActiveReport()
  })
}

async function reloadReports() {
  const content = document.getElementById('reportContent')
  if (content) content.innerHTML = '<div class="panel report-loading">Loading reports...</div>'

  reportData = await loadReportData()
  populateFilterOptions()
  renderActiveReport()
}

async function loadReportData() {
  const [
    students,
    teachers,
    parents,
    sections,
    subjects,
    enrollments,
    attendance,
    grades,
    schedules
  ] = await Promise.all([
    safeSelect('profiles', 'id,name,email,student_id,grade_level,section_id,status,role', query => query.eq('role', 'STUDENT')),
    safeSelect('profiles', 'id,name,email,teacher_id,department,status,role', query => query.eq('role', 'TEACHER')),
    safeSelect('profiles', 'id,name,email,status,role', query => query.eq('role', 'PARENT')),
    safeSelect('sections', '*'),
    safeSelect('subjects', '*'),
    safeSelect('enrollments', '*'),
    safeSelect('attendance', '*, profiles:student_id (name, student_id, grade_level, section_id)', query => query.order('attendance_date', { ascending: false })),
    safeSelect('grades', '*, profiles:student_id (name, student_id, grade_level, section_id)', query => query.order('created_at', { ascending: false })),
    safeSelect('schedules', '*')
  ])

  // Normalize attendance rows (map attendance_date -> date) for compatibility
  const normalizedAttendance = (attendance || []).map(r => ({ ...r, date: r.attendance_date || r.date }))
  return { students, teachers, parents, sections, subjects, enrollments, attendance: normalizedAttendance, grades, schedules }
}

async function safeSelect(table, columns = '*', applyQuery) {
  try {
    let query = supabase.from(table).select(columns)
    if (applyQuery) query = applyQuery(query)
    const { data, error } = await query
    if (error) {
      console.warn(`reports ${table}:`, error.message)
      return []
    }
    return data || []
  } catch (error) {
    console.warn(`reports ${table}:`, error.message)
    return []
  }
}

function applyReportFilters(notify = true) {
  filters.query = valueOf('reportSearch').toLocaleLowerCase()
  filters.startDate = valueOf('reportStartDate')
  filters.endDate = valueOf('reportEndDate')
  filters.gradeLevel = valueOf('reportGradeFilter')
  filters.section = valueOf('reportSectionFilter')
  filters.subject = valueOf('reportSubjectFilter')
  filters.teacher = valueOf('reportTeacherFilter')
  renderActiveReport()
  if (notify) showToast('Filters Applied', 'Reports updated', 'success')
}

function renderActiveReport() {
  document.querySelectorAll('[data-report-tab]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.reportTab === activeReport)
  })

  Object.keys(chartInstances).forEach(destroyChart)

  const content = document.getElementById('reportContent')
  if (!content) return

  const renderers = {
    overview: renderOverviewReport,
    attendance: renderAttendanceReport,
    academic: renderAcademicReport,
    enrollment: renderEnrollmentReport,
    teacher: renderTeacherReport,
    section: renderSectionReport,
    subject: renderSubjectReport,
    export: renderExportReport
  }

  content.innerHTML = renderers[activeReport]?.() || renderOverviewReport()
  requestAnimationFrame(renderChartsForActiveReport)
}

function renderOverviewReport() {
  const students = filteredStudents()
  const teachers = filteredTeachers()
  const attendance = filteredAttendance()
  const grades = filteredGrades()
  const enrollments = filteredEnrollments()
  const activeUsers = [...students, ...teachers, ...reportData.parents].filter(row => normalize(row.status) === 'active').length

  return `
    ${sectionTitle('Dashboard Overview', 'Main analytics page using profiles, sections, subjects, enrollments, attendance, and grades.')}
    ${summaryCards([
      ['Total Students', students.length],
      ['Total Teachers', teachers.length],
      ['Total Parents', reportData.parents.length],
      ['Total Sections', reportData.sections.length],
      ['Total Subjects', reportData.subjects.length],
    ])}
    ${chartGrid([
      ['Students per Grade Level', 'overviewStudentsGradeChart'],
      ['Attendance Percentage', 'overviewAttendancePercentChart'],
      ['Average Grades', 'overviewAverageGradesChart'],
      ['Enrollment Trends', 'overviewEnrollmentTrendChart'],
      ['Subject Distribution', 'overviewSubjectDistributionChart']
    ])}
    ${dataTable('Tables Used', ['Table', 'Records'], [
      ['users', students.length + teachers.length],
      ['sections', reportData.sections.length],
      ['subjects', reportData.subjects.length],
      ['enrollments', enrollments.length],
      ['attendance', attendance.length],
      ['grades', grades.length]
    ])}
  `
}

function renderAttendanceReport() {
  const attendance = filteredAttendance()
  const absent = attendance.filter(row => normalize(row.status) !== 'present')
  const present = attendance.length - absent.length
  const bySection = groupAttendanceBySection(attendance)
  const bySubject = countBy(attendance, row => row.subject || 'No subject')
  const byStudent = countBy(attendance, row => formatUserName(row.profiles?.name) || row.student_id || 'Unknown')

  return `
    ${sectionTitle('Attendance Reports', 'Daily, monthly, student, section, subject, and teacher attendance monitoring.')}
    ${summaryCards([
      ['Daily Attendance', countToday(attendance)],
      ['Monthly Attendance', countThisMonth(attendance, 'date')],
      ['Present Records', present],
      ['Absent Records', absent.length],
      ['Attendance Rate', attendance.length ? `${Math.round((present / attendance.length) * 100)}%` : '-'],
      ['Total Records', attendance.length],
      ['Attendance by Section', Object.keys(bySection).length],
      ['Attendance by Subject', Object.keys(bySubject).length],
      ['Attendance by Student', Object.keys(byStudent).length],
    ])}
    ${chartGrid([
      ['Present vs Absent', 'attendancePresentAbsentChart'],
      ['Attendance Trend', 'attendanceTrendReportChart'],
    ])}
    ${dataTable('Attendance Records', ['Date', 'Student', 'Grade', 'Status', 'Subject'], attendance.map(row => [
      formatDate(row.date),
      formatUserName(row.profiles?.name) || row.student_id || 'Unknown',
      row.profiles?.grade_level || '-',
      row.status || '-',
      row.subject || '-'
    ]))}
  `
}

function renderAcademicReport() {
  const grades = filteredGrades()
  const scores = grades.map(row => Number(row.score || row.grade || 0)).filter(score => Number.isFinite(score))
  const passed = scores.filter(score => score >= 75).length
  const failedRows = grades.filter(row => Number(row.score || row.grade || 0) < 75)
  const topRows = [...grades].sort((a, b) => Number(b.score || 0) - Number(a.score || 0)).slice(0, 10)

  return `
    ${sectionTitle('Academic Reports', 'Student grades, subject averages, performance rankings, distribution, and remarks analytics.')}
    ${summaryCards([
      ['Student Grades', grades.length],
      ['Highest Grade', scores.length ? Math.max(...scores).toFixed(1) : '-'],
      ['Lowest Grade', scores.length ? Math.min(...scores).toFixed(1) : '-'],
      ['Average Grade', scores.length ? average(scores).toFixed(1) : '-'],
      ['Passed', passed],
      ['Failed', failedRows.length]
    ])}
    ${chartGrid([
      ['Subject Averages', 'academicSubjectAverageChart'],
      ['Student Performance Trend', 'academicTrendChart'],
      ['Passed vs Failed', 'academicPassedFailedChart'],
      ['Grade Distribution', 'academicDistributionChart']
    ])}
    ${dataTable('Top Performing Students', ['Student', 'Subject', 'Score', 'Remarks'], topRows.map(row => [
      formatUserName(row.profiles?.name) || row.student_id || 'Unknown',
      row.subject || '-',
      row.score || '-',
      Number(row.score || 0) >= 75 ? 'Passed' : 'Failed'
    ]))}
    ${dataTable('Failed Students', ['Student', 'Subject', 'Score'], failedRows.slice(0, 10).map(row => [
      formatUserName(row.profiles?.name) || row.student_id || 'Unknown',
      row.subject || '-',
      row.score || '-'
    ]))}
  `
}

function renderEnrollmentReport() {
  const enrollments = filteredEnrollments()
  const bySection = countBy(enrollments, row => row.section || row.section_name || row.section_id || 'Unassigned')
  const byGrade = countBy(enrollments, row => row.grade_level || row.profiles?.grade_level || 'Unassigned')

  return `
    ${sectionTitle('Enrollment Reports', 'Enrollment totals, grade level grouping, section grouping, and growth trends.')}
    ${summaryCards([
      ['Total Enrolled Students', enrollments.length],
      ['Enrollment by Section', Object.keys(bySection).length],
      ['Enrollment by Grade Level', Object.keys(byGrade).length],
      ['Enrollment Growth Trends', countThisMonth(enrollments, 'created_at')]
    ])}
    ${chartGrid([
      ['Enrollment Growth', 'enrollmentGrowthChart'],
      ['Students per Section', 'enrollmentSectionChart'],
      ['Students per Grade Level', 'enrollmentGradeChart']
    ])}
    ${dataTable('Student Records', ['Student', 'LRN Number', 'Grade Level', 'Section', 'Status'], filteredStudents().map(row => [
      formatUserName(row.name) || row.name || '-',
      row.student_id || '-',
      row.grade_level || '-',
      reportData.sections.find(section => String(section.id) === String(row.section_id))?.name || '-',
      row.status || 'active',
    ]))}
    ${dataTable('Enrollment by Grade Level', ['Grade Level', 'Students'], objectRows(byGrade))}
  `
}

function renderTeacherReport() {
  const teachers = filteredTeachers()
  const schedules = filteredSchedules()
  const loadMap = teacherLoadMap()

  return `
    ${sectionTitle('Teacher Reports', 'Teacher subject load and class schedule overview from schedules, grades, and attendance.')}
    ${summaryCards([
      ['Total Teachers', teachers.length],
      ['Class Schedules', schedules.length],
      ['Attendance Records', filteredAttendance().length]
    ])}
    ${chartGrid([
      ['Subjects Handled', 'teacherSubjectsChart']
    ])}
    ${dataTable('Schedule Overview', ['Teacher', 'Subject', 'Section', 'Schedule'], schedules.slice(0, 20).map(row => [
      teacherName(row.teacher_id || row.teacher || row.teacher_name),
      row.subject || row.subject_name || row.subject_id || '-',
      row.section || row.section_name || row.section_id || '-',
      row.schedule || row.day || row.time || '-'
    ]))}
  `
}

function renderSectionReport() {
  const studentsByGrade = countBy(filteredStudents(), row => row.grade_level || 'Unassigned')

  return `
    ${sectionTitle('Section Reports', 'Students per section and section performance.')}
    ${summaryCards([
      ['Total Sections', reportData.sections.length],
      ['Section Performance', filteredGrades().length ? average(filteredGrades().map(row => Number(row.score || 0))).toFixed(1) : '-']
    ])}
    ${chartGrid([
      ['Population per Section', 'sectionPopulationChart'],
      ['Section Performance', 'sectionPerformanceChart']
    ])}
    ${dataTable('Students per Grade Level', ['Grade Level', 'Students'], objectRows(studentsByGrade))}
  `
}

function renderSubjectReport() {
  const gradeSubjects = countBy(filteredGrades(), row => row.subject || 'No subject')
  const subjectRows = reportData.subjects.length
    ? reportData.subjects.map(row => [row.name || row.subject_name || row.code || row.id, row.grade_level || row.department || '-'])
    : objectRows(gradeSubjects)

  return `
    ${sectionTitle('Subject Reports', 'Subject distribution, usage in grades, and available subject records.')}
    ${summaryCards([
      ['Total Subjects', reportData.subjects.length || Object.keys(gradeSubjects).length],
      ['Graded Subjects', Object.keys(gradeSubjects).length],
      ['Grade Records', filteredGrades().length]
    ])}
    ${chartGrid([
      ['Subject Distribution', 'subjectDistributionChart'],
      ['Average Score per Subject', 'subjectAverageChart']
    ])}
    ${dataTable('Subjects', ['Subject', 'Details'], subjectRows.slice(0, 20))}
  `
}

function renderExportReport() {
  return `
    ${sectionTitle('Export & Print', 'Export charts, tables, summary cards, and date-filtered report content.')}
    <div class="report-export-grid">
      ${exportAction('Print', 'printReportBtnMirror', 'Print current report page')}
      ${exportAction('PDF', 'exportPdfBtnMirror', 'Open print dialog for Save as PDF')}
      ${exportAction('Excel', 'exportExcelBtnMirror', 'Download workbook-compatible file')}
      ${exportAction('CSV', 'exportCsvBtnMirror', 'Download report tables and summaries')}
    </div>
    ${summaryCards([
      ['Charts', document.querySelectorAll('#reportContent canvas').length || 'All report charts'],
      ['Tables', 'Included'],
      ['Summary Cards', 'Included'],
      ['Date Filters', filters.startDate || filters.endDate ? `${filters.startDate || 'Any'} to ${filters.endDate || 'Any'}` : 'All dates']
    ])}
  `
}

function renderChartsForActiveReport() {
  const charts = {
    overview: () => {
      barChart('overviewStudentsGradeChart', 'Students', countBy(filteredStudents(), row => row.grade_level || 'Unassigned'))
      doughnutChart('overviewAttendancePercentChart', countAttendanceStatuses(filteredAttendance()))
      barChart('overviewAverageGradesChart', 'Average Grade', subjectAverages())
      lineChart('overviewEnrollmentTrendChart', 'Enrollments', monthlyCounts(filteredEnrollments(), 'created_at'))
      doughnutChart('overviewSubjectDistributionChart', countBy(filteredGrades(), row => row.subject || 'No subject'))
    },
    attendance: () => {
      doughnutChart('attendancePresentAbsentChart', countAttendanceStatuses(filteredAttendance()))
      lineChart('attendanceTrendReportChart', 'Attendance', dailyCounts(filteredAttendance(), 'date'))
      barChart('attendanceSectionChart', 'Records', groupAttendanceBySection(filteredAttendance()))
    },
    academic: () => {
      barChart('academicSubjectAverageChart', 'Average Score', subjectAverages())
      lineChart('academicTrendChart', 'Average Score', dailyAverage(filteredGrades(), 'created_at', 'score'))
      doughnutChart('academicPassedFailedChart', passedFailedCounts(filteredGrades()))
      barChart('academicDistributionChart', 'Students', gradeDistribution(filteredGrades()))
    },
    enrollment: () => {
      lineChart('enrollmentGrowthChart', 'Enrollments', monthlyCounts(filteredEnrollments(), 'created_at'))
      barChart('enrollmentSectionChart', 'Students', countBy(filteredEnrollments(), row => row.section || row.section_name || row.section_id || 'Unassigned'))
      barChart('enrollmentGradeChart', 'Students', countBy(filteredEnrollments(), row => row.grade_level || row.profiles?.grade_level || 'Unassigned'))
    },
    teacher: () => barChart('teacherSubjectsChart', 'Subjects', teacherLoadMap()),
    section: () => {
      barChart('sectionPopulationChart', 'Students', countBy(filteredStudents(), row => row.section || row.section_name || row.grade_level || 'Unassigned'))
      barChart('sectionPerformanceChart', 'Average Score', sectionPerformance())
    },
    subject: () => {
      doughnutChart('subjectDistributionChart', countBy(filteredGrades(), row => row.subject || 'No subject'))
      barChart('subjectAverageChart', 'Average Score', subjectAverages())
    },
    export: () => {
      document.getElementById('printReportBtnMirror')?.addEventListener('click', printCurrentReport)
      document.getElementById('exportPdfBtnMirror')?.addEventListener('click', exportReportAsPDF)
      document.getElementById('exportExcelBtnMirror')?.addEventListener('click', exportReportAsExcel)
      document.getElementById('exportCsvBtnMirror')?.addEventListener('click', exportReportAsCSV)
    }
  }

  charts[activeReport]?.()
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
      scales: type === 'doughnut' || type === 'pie' ? undefined : { y: { beginAtZero: true } },
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

function barChart(canvasId, label, rows) {
  const labels = Object.keys(rows)
  createChart(canvasId, 'bar', {
    labels: labels.length ? labels : ['No data'],
    datasets: [{
      label,
      data: labels.length ? Object.values(rows) : [0],
      backgroundColor: chartPalette,
      borderRadius: 6
    }]
  }, { plugins: { legend: { display: false } } })
}

function lineChart(canvasId, label, rows) {
  const labels = Object.keys(rows)
  createChart(canvasId, 'line', {
    labels: labels.length ? labels : ['No data'],
    datasets: [{
      label,
      data: labels.length ? Object.values(rows) : [0],
      borderColor: '#2563EB',
      backgroundColor: 'rgba(37, 99, 235, .12)',
      fill: true,
      tension: .35
    }]
  })
}

function doughnutChart(canvasId, rows) {
  const labels = Object.keys(rows)
  createChart(canvasId, 'doughnut', {
    labels: labels.length ? labels : ['No data'],
    datasets: [{
      data: labels.length ? Object.values(rows) : [0],
      backgroundColor: chartPalette
    }]
  })
}

function sectionTitle(title, subtitle) {
  return `
    <div class="report-section-title">
      <h3>${title}</h3>
      <p>${subtitle}</p>
    </div>
  `
}

function summaryCards(items) {
  return `
    <div class="stats-grid report-stats-grid">
      ${items.map(([label, value]) => `
        <div class="stat-card report-stat-card">
          <div class="stat-value">${escapeHtml(value)}</div>
          <div class="stat-label">${escapeHtml(label)}</div>
        </div>
      `).join('')}
    </div>
  `
}

function chartGrid(charts) {
  return `
    <div class="charts-grid report-chart-grid">
      ${charts.map(([title, id]) => `
        <div class="chart-card">
          <div class="chart-header"><h3>${title}</h3></div>
          <div class="chart-body"><canvas id="${id}"></canvas></div>
        </div>
      `).join('')}
    </div>
  `
}

function dataTable(title, headers, rows) {
  return `
    <div class="panel report-table-panel">
      <h3>${title}</h3>
      <div class="table-wrap">
        <table>
          <thead><tr>${headers.map(head => `<th>${head}</th>`).join('')}</tr></thead>
          <tbody>
            ${rows.length ? rows.map(row => `<tr>${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${headers.length}">No records found</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `
}

function exportAction(label, id, text) {
  return `
    <button class="panel report-export-action" id="${id}" type="button">
      <strong>${label}</strong>
      <span>${text}</span>
    </button>
  `
}

function filteredStudents() {
  return reportData.students.filter(row =>
    (!filters.gradeLevel || normalizeGradeLevel(row.grade_level) === normalizeGradeLevel(filters.gradeLevel)) &&
    (!filters.section || String(row.section_id || '') === String(filters.section)) &&
    matchesSearch([row.name, row.email, row.student_id, row.grade_level])
  )
}

function filteredTeachers() {
  return reportData.teachers.filter(row =>
    (!filters.teacher || row.id === filters.teacher || row.name === filters.teacher) &&
    matchesSearch([row.name, row.email, row.teacher_id, row.department])
  )
}

function filteredAttendance() {
  return reportData.attendance.filter(row => {
    const grade = row.profiles?.grade_level || row.grade_level || ''
    return inDateRange(row.date) &&
      (!filters.gradeLevel || normalizeGradeLevel(grade) === normalizeGradeLevel(filters.gradeLevel)) &&
      (!filters.section || String(row.profiles?.section_id || row.section_id || '') === String(filters.section)) &&
      (!filters.subject || row.subject === filters.subject || String(row.subject_id || '') === String(filters.subject)) &&
      (!filters.teacher || String(row.teacher_id || '') === String(filters.teacher) || row.teacher === filters.teacher) &&
      matchesSearch([row.profiles?.name, row.profiles?.student_id, row.subject, row.status])
  })
}

function filteredGrades() {
  return reportData.grades.filter(row => {
    const grade = row.profiles?.grade_level || row.grade_level || ''
    return inDateRange(row.created_at || row.date) &&
      (!filters.gradeLevel || normalizeGradeLevel(grade) === normalizeGradeLevel(filters.gradeLevel)) &&
      (!filters.section || String(row.profiles?.section_id || row.section_id || '') === String(filters.section)) &&
      (!filters.subject || row.subject === filters.subject || String(row.subject_id || '') === String(filters.subject)) &&
      (!filters.teacher || String(row.teacher_id || '') === String(filters.teacher) || row.teacher === filters.teacher) &&
      matchesSearch([row.profiles?.name, row.profiles?.student_id, row.subject, row.remarks, row.score])
  })
}

function filteredEnrollments() {
  return reportData.enrollments.filter(row => {
    return inDateRange(row.created_at || row.date) &&
      (!filters.gradeLevel || normalizeGradeLevel(row.grade_level || row.profiles?.grade_level) === normalizeGradeLevel(filters.gradeLevel)) &&
      (!filters.section || String(row.section_id || '') === String(filters.section) || row.section === filters.section || row.section_name === filters.section) &&
      matchesSearch([row.student_name, row.name, row.email, row.student_id, row.section, row.section_name])
  })
}

function filteredSchedules() {
  return reportData.schedules.filter(row => {
    return (!filters.section || String(row.section_id || '') === String(filters.section) || row.section === filters.section || row.section_name === filters.section) &&
      (!filters.subject || String(row.subject_id || '') === String(filters.subject) || row.subject === filters.subject || row.subject_name === filters.subject) &&
      (!filters.teacher || String(row.teacher_id || '') === String(filters.teacher) || row.teacher === filters.teacher || row.teacher_name === filters.teacher) &&
      matchesSearch([row.subject, row.subject_name, row.teacher_name, row.section_name, row.room, row.day])
  })
}

function normalizeGradeLevel(value) {
  return String(value || '').trim().toLocaleLowerCase().replace(/^grade\s*/, '')
}

function matchesSearch(values) {
  return !filters.query || values.some(value => String(value || '').toLocaleLowerCase().includes(filters.query))
}

function populateFilterOptions() {
  setOptions('reportSectionFilter', 'All Sections', reportData.sections.map(row => [row.id || row.name, row.name || row.section_name || row.id]))
  setOptions('reportSubjectFilter', 'All Subjects', subjectOptions())
  setOptions('reportTeacherFilter', 'All Teachers', reportData.teachers.map(row => [row.id, formatUserName(row.name) || row.email || row.id]))
}

function subjectOptions() {
  const options = reportData.subjects.map(row => [row.id || row.name || row.subject_name, row.name || row.subject_name || row.code || row.id])
  if (options.length) return options
  return Object.keys(countBy(reportData.grades, row => row.subject || '')).filter(Boolean).map(subject => [subject, subject])
}

function setOptions(id, allLabel, options) {
  const el = document.getElementById(id)
  if (!el) return
  const current = el.value
  const seen = new Set()
  const normalized = options.filter(([value]) => value && !seen.has(value) && seen.add(value))
  el.innerHTML = `<option value="">${allLabel}</option>` + normalized.map(([value, label]) => `<option value="${escapeAttr(value)}">${escapeHtml(label)}</option>`).join('')
  el.value = current
}

function countBy(rows, getKey) {
  return rows.reduce((acc, row) => {
    const key = String(getKey(row) || 'Unassigned')
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
}

function countAttendanceStatuses(rows) {
  const counts = { Present: 0, Absent: 0 }
  rows.forEach(row => {
    const status = normalize(row.status)
    if (status === 'present') counts.Present++
    else counts.Absent++
  })
  return counts
}

function groupAttendanceBySection(rows) {
  return countBy(rows, row => row.section || row.section_name || row.profiles?.grade_level || 'Unassigned')
}

function subjectAverages() {
  const groups = {}
  filteredGrades().forEach(row => {
    const subject = row.subject || 'No subject'
    if (!groups[subject]) groups[subject] = []
    groups[subject].push(Number(row.score || row.grade || 0))
  })
  return Object.fromEntries(Object.entries(groups).map(([key, values]) => [key, Number(average(values).toFixed(1))]))
}

function passedFailedCounts(rows) {
  return rows.reduce((acc, row) => {
    Number(row.score || row.grade || 0) >= 75 ? acc.Passed++ : acc.Failed++
    return acc
  }, { Passed: 0, Failed: 0 })
}

function gradeDistribution(rows) {
  const ranges = { '90-100': 0, '80-89': 0, '75-79': 0, 'Below 75': 0 }
  rows.forEach(row => {
    const score = Number(row.score || row.grade || 0)
    if (score >= 90) ranges['90-100']++
    else if (score >= 80) ranges['80-89']++
    else if (score >= 75) ranges['75-79']++
    else ranges['Below 75']++
  })
  return ranges
}

function sectionPerformance() {
  const groups = {}
  filteredGrades().forEach(row => {
    const key = row.section || row.section_name || row.profiles?.grade_level || 'Unassigned'
    if (!groups[key]) groups[key] = []
    groups[key].push(Number(row.score || row.grade || 0))
  })
  return Object.fromEntries(Object.entries(groups).map(([key, values]) => [key, Number(average(values).toFixed(1))]))
}

function teacherLoadMap() {
  const fromSchedules = countBy(filteredSchedules(), row => teacherName(row.teacher_id || row.teacher || row.teacher_name))
  if (Object.keys(fromSchedules).length) return fromSchedules
  return countBy(filteredGrades(), row => teacherName(row.teacher_id || row.teacher || row.teacher_name || 'Unassigned'))
}

function dailyCounts(rows, field) {
  return countBy(rows, row => formatDate(row[field]))
}

function dailyAverage(rows, dateField, valueField) {
  const groups = {}
  rows.forEach(row => {
    const key = formatDate(row[dateField])
    if (!groups[key]) groups[key] = []
    groups[key].push(Number(row[valueField] || 0))
  })
  return Object.fromEntries(Object.entries(groups).slice(0, 14).map(([key, values]) => [key, Number(average(values).toFixed(1))]))
}

function monthlyCounts(rows, field) {
  return countBy(rows, row => {
    const date = row[field] ? new Date(row[field]) : null
    return date && !Number.isNaN(date.valueOf()) ? date.toLocaleString('default', { month: 'short', year: '2-digit' }) : 'No date'
  })
}

function countToday(rows) {
  const today = new Date().toISOString().slice(0, 10)
  return rows.filter(row => String(row.date || '').slice(0, 10) === today).length
}

function countThisMonth(rows, field) {
  const now = new Date()
  return rows.filter(row => {
    const date = row[field] ? new Date(row[field]) : null
    return date && date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear()
  }).length
}

function average(values) {
  const nums = values.map(Number).filter(Number.isFinite)
  return nums.length ? nums.reduce((sum, value) => sum + value, 0) / nums.length : 0
}

function objectRows(obj) {
  return Object.entries(obj).map(([key, value]) => [key, value])
}

function teacherName(value) {
  const teacher = reportData.teachers.find(row => row.id === value || row.teacher_id === value || row.name === value)
  return formatUserName(teacher?.name) || value || 'Unassigned'
}

function inDateRange(value) {
  if (!value || (!filters.startDate && !filters.endDate)) return true
  const date = String(value).slice(0, 10)
  return (!filters.startDate || date >= filters.startDate) && (!filters.endDate || date <= filters.endDate)
}

function formatDate(value) {
  if (!value) return '-'
  return String(value).slice(0, 10)
}

function valueOf(id) {
  return (document.getElementById(id)?.value || '').trim()
}

function normalize(value) {
  return String(value || '').trim().toLowerCase()
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]))
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;')
}

async function exportReportAsCSV() {
  const rows = buildExportRows()
  const csv = rows.map(row => row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
  downloadBlob(csv, `reports-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8;')
  showToast('Success', 'Report exported as CSV', 'success')
}

async function exportReportAsExcel() {
  const rows = buildExportRows()
  if (window.XLSX) {
    const worksheet = XLSX.utils.aoa_to_sheet(rows)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Reports')
    XLSX.writeFile(workbook, `reports-${new Date().toISOString().slice(0, 10)}.xlsx`)
  } else {
    const csv = rows.map(row => row.join(',')).join('\n')
    downloadBlob(csv, `reports-${new Date().toISOString().slice(0, 10)}.xls`, 'application/vnd.ms-excel')
  }
  showToast('Success', 'Report exported as Excel', 'success')
}

async function loadPrintBranding() {
  const { data, error } = await supabase.rpc('get_public_school_branding')
  if (error) throw error
  const settings = Object.fromEntries((data || []).map(row => [row.key, row.value]))
  const logo = document.querySelector('[data-school-logo]:not(link), .sidebar-logo')
  printBranding = {
    name: String(settings.school_name || 'Eastern Porac National High School').trim(),
    address: String(settings.school_address || '').trim(),
    logo: String(settings.school_logo_url || logo?.src || 'logo.png').trim(),
  }
}

function getReportPeriodLabel() {
  const period = filters.startDate || filters.endDate
    ? `${filters.startDate || 'Start date not set'} to ${filters.endDate || 'End date not set'}`
    : `Generated ${new Date().toLocaleDateString()}`
  const appliedFilters = [
    filters.gradeLevel ? `Grade: ${filters.gradeLevel}` : '',
    filters.section ? `Section: ${reportData.sections.find(section => String(section.id) === String(filters.section))?.name || filters.section}` : '',
    filters.subject ? `Subject: ${document.querySelector('#reportSubjectFilter option:checked')?.textContent || filters.subject}` : '',
    filters.teacher ? `Teacher: ${document.querySelector('#reportTeacherFilter option:checked')?.textContent || filters.teacher}` : '',
    filters.query ? `Search: ${filters.query}` : '',
  ].filter(Boolean)
  return [period, ...appliedFilters].join(' · ')
}

async function preparePrintableReport() {
  await loadPrintBranding()
  const content = document.getElementById('reportContent')
  if (!content) throw new Error('The current report is not available.')

  const printable = content.cloneNode(true)
  printable.querySelectorAll('.report-chart-grid, .chart-card, .report-export-grid, button').forEach(element => element.remove())
  const description = printable.querySelector('.report-section-title p')?.textContent.trim() || ''
  printable.querySelector('.report-section-title')?.remove()
  printable.querySelectorAll('.report-table-panel').forEach(panel => {
    panel.classList.remove('panel')
    panel.querySelector('.table-wrap')?.classList.remove('table-wrap')
  })

  let printRoot = document.getElementById('reportPrintRoot')
  if (!printRoot) {
    printRoot = document.createElement('main')
    printRoot.id = 'reportPrintRoot'
    printRoot.className = 'report-print-root'
    document.body.appendChild(printRoot)
  }

  const reportTitle = REPORTS.find(report => report.id === activeReport)?.label || 'Reports'
  printRoot.classList.toggle('report-print-landscape', ['attendance', 'academic', 'enrollment', 'teacher'].includes(activeReport))
  printRoot.innerHTML = `
    <header class="report-print-header">
      <img src="${escapeAttr(printBranding.logo)}" alt="School logo" class="report-print-logo">
      <div class="report-print-school">
        <h1>${escapeHtml(printBranding.name)}</h1>
        <p>${escapeHtml(printBranding.address || 'School address not configured')}</p>
      </div>
    </header>
    <div class="report-print-heading">
      <h2>${escapeHtml(reportTitle)}</h2>
      <p>${escapeHtml(getReportPeriodLabel())}</p>
      ${description ? `<p class="report-print-description">${escapeHtml(description)}</p>` : ''}
    </div>
    <div class="report-print-content">${printable.innerHTML}</div>
    <footer class="report-print-footer">
      <span>${escapeHtml(printBranding.name)} · Official Report</span>
      <span>Page <span class="report-print-page-number"></span></span>
    </footer>`
}

async function printCurrentReport() {
  try {
    await preparePrintableReport()
    window.print()
  } catch (error) {
    console.error('Report print preparation failed:', error)
    showToast('Report not ready', error.message || 'The printable report could not be prepared.', 'error')
  }
}

async function exportReportAsPDF() {
  await printCurrentReport()
}

function buildExportRows() {
  const attendance = filteredAttendance()
  const grades = filteredGrades()
  const enrollments = filteredEnrollments()
  return [
    ['EASPO Reports'],
    ['Generated', new Date().toLocaleString()],
    ['Report', REPORTS.find(row => row.id === activeReport)?.label || 'Reports'],
    ['Date Filter', filters.startDate || 'Any', filters.endDate || 'Any'],
    [],
    ['Summary'],
    ['Students', filteredStudents().length],
    ['Teachers', filteredTeachers().length],
    ['Parents', reportData.parents.length],
    ['Sections', reportData.sections.length],
    ['Subjects', reportData.subjects.length],
    ['Enrollments', enrollments.length],
    ['Attendance Records', attendance.length],
    ['Grade Records', grades.length],
    [],
    ['Attendance', 'Date', 'Student', 'Status', 'Subject'],
    ...attendance.slice(0, 200).map(row => ['', formatDate(row.date), formatUserName(row.profiles?.name) || row.student_id || '', row.status || '', row.subject || '']),
    [],
    ['Grades', 'Student', 'Subject', 'Score', 'Date'],
    ...grades.slice(0, 200).map(row => ['', formatUserName(row.profiles?.name) || row.student_id || '', row.subject || '', row.score || '', formatDate(row.created_at)])
  ]
}

function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
}

function subscribeToReportUpdates() {
  hasSubscribed = true
  supabase.channel('reports-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, reloadReports)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, reloadReports)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'grades' }, reloadReports)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'enrollments' }, reloadReports)
    .subscribe()
}

function injectReportStyles() {
  if (document.getElementById('reportsModuleStyles')) return
  const style = document.createElement('style')
  style.id = 'reportsModuleStyles'
  style.textContent = `
    .reports-layout{display:grid;grid-template-columns:230px minmax(0,1fr);gap:20px;align-items:start}
    .reports-nav{position:sticky;top:88px;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px;box-shadow:var(--shadow-sm)}
    .reports-nav-title{font-weight:800;color:var(--text);font-size:.82rem;margin:4px 6px 10px}
    .reports-nav-btn{width:100%;border:0;background:transparent;color:var(--text2);padding:10px 12px;border-radius:6px;text-align:left;font-weight:650;cursor:pointer}
    .reports-nav-btn:hover,.reports-nav-btn.active{background:var(--primary-dim);color:var(--primary)}
    .reports-main{min-width:0}
    .report-filters-panel{margin-bottom:20px}
    .reports-filter-grid{display:grid;grid-template-columns:repeat(6,minmax(130px,1fr)) auto;gap:12px;align-items:end}
    .reports-filter-grid label span{display:block;font-size:12px;color:var(--text2);font-weight:700;margin-bottom:6px}
    .report-section-title{margin:6px 0 16px}
    .report-section-title h3{font-size:1.15rem;margin:0;color:var(--text)}
    .report-section-title p{margin:4px 0 0;color:var(--text2);font-size:.9rem}
    .report-stats-grid{margin-bottom:20px}
    .report-stat-card{min-height:104px}
    .report-chart-grid{margin-bottom:20px}
    .report-table-panel{margin-top:20px}
    .report-table-panel h3{margin:0 0 12px;font-size:1rem}
    .report-table-panel .table-wrap{overflow-x:auto}
    .report-table-panel table{width:100%;border-collapse:collapse}
    .report-table-panel th,.report-table-panel td{padding:9px 11px;text-align:left;vertical-align:top}
    .report-export-grid{display:grid;grid-template-columns:repeat(4,minmax(150px,1fr));gap:14px;margin-bottom:20px}
    .report-export-action{display:flex;flex-direction:column;gap:6px;text-align:left;cursor:pointer;color:var(--text)}
    .report-export-action span{color:var(--text2);font-size:.82rem}
    .report-loading{text-align:center;padding:32px;color:var(--text2)}
    .filter-select{padding:6px 8px;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);font-size:14px}
    @media (max-width:1100px){.reports-layout{grid-template-columns:1fr}.reports-nav{position:static;display:grid;grid-template-columns:repeat(2,1fr)}.reports-nav-title{grid-column:1/-1}.reports-filter-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media (max-width:640px){.reports-nav,.reports-filter-grid,.report-export-grid{grid-template-columns:1fr}.reports-layout{gap:14px}}
    .report-print-root{display:none}
    @media print{
      @page{size:auto;margin:16mm 12mm 20mm}
      @page reportLandscape{size:landscape;margin:12mm 12mm 18mm}
      body *{visibility:hidden!important}
      #reportPrintRoot,#reportPrintRoot *{visibility:visible!important}
      body>:not(#reportPrintRoot){display:none!important}
      #reportPrintRoot{display:block!important;position:relative;width:100%;padding-bottom:10mm;background:#fff;color:#111827;font:10pt/1.4 Arial,sans-serif}
      #reportPrintRoot.report-print-landscape{page:reportLandscape}
      .report-print-header{display:flex;align-items:center;gap:18px;border-bottom:2px solid #1e3a5f;padding:0 0 12px;margin-bottom:18px}
      .report-print-logo{width:72px;height:72px;object-fit:contain}
      .report-print-school h1{font-size:17pt;margin:0 0 4px;color:#17365d}
      .report-print-school p,.report-print-heading p{font-size:9pt;margin:0;color:#4b5563}
      .report-print-heading{text-align:center;margin:16px 0 20px}
      .report-print-heading h2{font-size:14pt;margin:0 0 4px}
      .report-print-description{margin-top:6px!important}
      .report-print-content .stats-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:0 0 16px}
      .report-print-content .stat-card{min-height:0;padding:8px;border:1px solid #cbd5e1;background:#fff;box-shadow:none;break-inside:avoid}
      .report-print-content .stat-value{font-size:14pt;color:#111827}
      .report-print-content .stat-label{font-size:8pt;color:#374151}
      .report-print-content .report-table-panel{margin:0 0 16px;break-inside:auto}
      .report-print-content .report-table-panel h3{font-size:11pt;margin:0 0 7px}
      .report-print-content table{width:100%;border-collapse:collapse;table-layout:auto;font-size:8.5pt}
      .report-print-content thead{display:table-header-group}
      .report-print-content th,.report-print-content td{border:1px solid #9ca3af;padding:5px 7px;text-align:left;vertical-align:top;overflow-wrap:anywhere}
      .report-print-content th{background:#e8eef5!important;color:#111827;font-weight:700;print-color-adjust:exact;-webkit-print-color-adjust:exact}
      .report-print-content tr{break-inside:avoid}
      .report-print-content .report-section-title,.report-print-content .report-chart-grid,.report-print-content .report-export-grid{display:none!important}
      .report-print-footer{position:fixed;left:0;right:0;bottom:-14mm;border-top:1px solid #9ca3af;padding-top:4px;display:flex;justify-content:space-between;font-size:8pt;color:#4b5563}
      .report-print-page-number:after{content:counter(page)}
    }
  `
  document.head.appendChild(style)
}