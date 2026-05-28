// /js/modules/reports.js
import { supabase } from '../services/supabaseClient.js'
import { showToast } from '../ui/toast.js'

let chartInstances = {}
let reportData = {
  students: [],
  teachers: [],
  parents: [],
  attendance: [],
  grades: []
}

// ── Initialize ────────────────────────────────────────────
export async function initReportsSection() {
  loadReportData()
}

// ── Load all report data ──────────────────────────────────
async function loadReportData() {
  try {
    const [studentsRes, teachersRes, parentsRes, attendanceRes, gradesRes] = await Promise.all([
      supabase.from('profiles').select('id,name,grade_level,created_at').eq('role','STUDENT'),
      supabase.from('profiles').select('id,name,department,created_at').eq('role','TEACHER'),
      supabase.from('profiles').select('id,name,created_at').eq('role','PARENT'),
      supabase.from('attendance').select('id,status,date'),
      supabase.from('grades').select('id,score,student_id')
    ])

    reportData.students = studentsRes.data || []
    reportData.teachers = teachersRes.data || []
    reportData.parents = parentsRes.data || []
    reportData.attendance = attendanceRes.data || []
    reportData.grades = gradesRes.data || []

    updateSummaryCards()
    renderAllCharts()
  } catch(e) {
    showToast('Error', 'Failed to load report data', 'error')
    console.error(e)
  }
}

// ── Update Summary Cards ──────────────────────────────────
function updateSummaryCards() {
  const totalStudents = reportData.students.length
  const totalTeachers = reportData.teachers.length
  const totalParents = reportData.parents.length
  
  // Calculate attendance rate
  const presentCount = reportData.attendance.filter(a => a.status === 'present').length
  const totalAttendance = reportData.attendance.length
  const attendanceRate = totalAttendance > 0 ? Math.round((presentCount / totalAttendance) * 100) : 0

  document.getElementById('reportTotalStudents').textContent = totalStudents
  document.getElementById('reportTotalTeachers').textContent = totalTeachers
  document.getElementById('reportTotalParents').textContent = totalParents
  document.getElementById('reportAttendanceRate').textContent = `${attendanceRate}%`
}

// ── Render all charts ─────────────────────────────────────
function renderAllCharts() {
  renderStudentGradeChart()
  renderAttendanceChart()
  renderGradeDistributionChart()
  renderTeacherDeptChart()
  renderEnrollmentTrendChart()
  renderAttendanceTrendChart()
}

// ── Student Grade Chart ───────────────────────────────────
function renderStudentGradeChart() {
  const ctx = document.getElementById('studentGradeChart')
  if (!ctx) return

  const gradeCounts = {}
  const VALID_GRADES = ['Grade 7', 'Grade 8', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12']
  
  VALID_GRADES.forEach(g => gradeCounts[g] = 0)
  
  reportData.students.forEach(s => {
    if (s.grade_level && VALID_GRADES.includes(s.grade_level)) {
      gradeCounts[s.grade_level]++
    }
  })

  if (chartInstances.studentGradeChart) {
    chartInstances.studentGradeChart.destroy()
  }

  chartInstances.studentGradeChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: VALID_GRADES,
      datasets: [{
        label: 'Number of Students',
        data: VALID_GRADES.map(g => gradeCounts[g]),
        backgroundColor: 'rgba(99, 102, 241, 0.8)',
        borderColor: 'rgba(99, 102, 241, 1)',
        borderWidth: 1,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { stepSize: 1 } }
      }
    }
  })
}

// ── Attendance Chart ──────────────────────────────────────
function renderAttendanceChart() {
  const ctx = document.getElementById('attendanceChart')
  if (!ctx) return

  const statusCounts = {
    present: 0,
    absent: 0,
    late: 0,
    excused: 0
  }

  reportData.attendance.forEach(a => {
    if (a.status && statusCounts.hasOwnProperty(a.status)) {
      statusCounts[a.status]++
    }
  })

  if (chartInstances.attendanceChart) {
    chartInstances.attendanceChart.destroy()
  }

  chartInstances.attendanceChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Present', 'Absent', 'Late', 'Excused'],
      datasets: [{
        data: [statusCounts.present, statusCounts.absent, statusCounts.late, statusCounts.excused],
        backgroundColor: ['#10b981', '#ef4444', '#f97316', '#f59e0b'],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'bottom' }
      }
    }
  })
}

// ── Grade Distribution Chart ──────────────────────────────
function renderGradeDistributionChart() {
  const ctx = document.getElementById('gradeDistributionChart')
  if (!ctx) return

  const ranges = {
    'Excellent (90-100)': 0,
    'Good (80-89)': 0,
    'Satisfactory (70-79)': 0,
    'Needs Improvement (60-69)': 0,
    'Failing (<60)': 0
  }

  reportData.grades.forEach(g => {
    const score = g.score || 0
    if (score >= 90) ranges['Excellent (90-100)']++
    else if (score >= 80) ranges['Good (80-89)']++
    else if (score >= 70) ranges['Satisfactory (70-79)']++
    else if (score >= 60) ranges['Needs Improvement (60-69)']++
    else ranges['Failing (<60)']++
  })

  if (chartInstances.gradeDistributionChart) {
    chartInstances.gradeDistributionChart.destroy()
  }

  chartInstances.gradeDistributionChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: Object.keys(ranges),
      datasets: [{
        label: 'Number of Grades',
        data: Object.values(ranges),
        backgroundColor: ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#ef4444'],
        borderRadius: 4
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { beginAtZero: true, ticks: { stepSize: 1 } }
      }
    }
  })
}

// ── Teacher Department Chart ──────────────────────────────
function renderTeacherDeptChart() {
  const ctx = document.getElementById('teacherDeptChart')
  if (!ctx) return

  const deptCounts = {}

  reportData.teachers.forEach(t => {
    const dept = t.department || 'Unassigned'
    deptCounts[dept] = (deptCounts[dept] || 0) + 1
  })

  if (chartInstances.teacherDeptChart) {
    chartInstances.teacherDeptChart.destroy()
  }

  chartInstances.teacherDeptChart = new Chart(ctx, {
    type: 'pie',
    data: {
      labels: Object.keys(deptCounts),
      datasets: [{
        data: Object.values(deptCounts),
        backgroundColor: [
          '#6366f1', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'
        ]
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'bottom' }
      }
    }
  })
}

// ── Enrollment Trend Chart ────────────────────────────────
function renderEnrollmentTrendChart() {
  const ctx = document.getElementById('enrollmentTrendChart')
  if (!ctx) return

  // Group students by creation month
  const monthlyEnrollment = {}
  const months = []
  
  for (let i = 11; i >= 0; i--) {
    const d = new Date()
    d.setMonth(d.getMonth() - i)
    const key = d.toLocaleDateString('en-US', { year: 'numeric', month: 'short' })
    months.push(key)
    monthlyEnrollment[key] = 0
  }

  reportData.students.forEach(s => {
    if (s.created_at) {
      const date = new Date(s.created_at)
      const key = date.toLocaleDateString('en-US', { year: 'numeric', month: 'short' })
      if (monthlyEnrollment.hasOwnProperty(key)) {
        monthlyEnrollment[key]++
      }
    }
  })

  if (chartInstances.enrollmentTrendChart) {
    chartInstances.enrollmentTrendChart.destroy()
  }

  chartInstances.enrollmentTrendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: months,
      datasets: [{
        label: 'New Enrollments',
        data: months.map(m => monthlyEnrollment[m]),
        borderColor: '#6366f1',
        backgroundColor: 'rgba(99, 102, 241, 0.1)',
        tension: 0.4,
        fill: true,
        pointBackgroundColor: '#6366f1',
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
        pointRadius: 5
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { stepSize: 1 } }
      }
    }
  })
}

// ── Attendance Trend Chart ────────────────────────────────
function renderAttendanceTrendChart() {
  const ctx = document.getElementById('attendanceTrendChart')
  if (!ctx) return

  const monthlyStats = {}
  const months = []

  for (let i = 11; i >= 0; i--) {
    const d = new Date()
    d.setMonth(d.getMonth() - i)
    const key = d.toLocaleDateString('en-US', { year: 'numeric', month: 'short' })
    months.push(key)
    monthlyStats[key] = { present: 0, total: 0 }
  }

  reportData.attendance.forEach(a => {
    if (a.date) {
      const date = new Date(a.date)
      const key = date.toLocaleDateString('en-US', { year: 'numeric', month: 'short' })
      if (monthlyStats.hasOwnProperty(key)) {
        monthlyStats[key].total++
        if (a.status === 'present') monthlyStats[key].present++
      }
    }
  })

  const attendanceRates = months.map(m => {
    const stats = monthlyStats[m]
    return stats.total > 0 ? Math.round((stats.present / stats.total) * 100) : 0
  })

  if (chartInstances.attendanceTrendChart) {
    chartInstances.attendanceTrendChart.destroy()
  }

  chartInstances.attendanceTrendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: months,
      datasets: [{
        label: 'Attendance Rate (%)',
        data: attendanceRates,
        borderColor: '#10b981',
        backgroundColor: 'rgba(16, 185, 129, 0.1)',
        tension: 0.4,
        fill: true,
        pointBackgroundColor: '#10b981',
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
        pointRadius: 5
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, max: 100, ticks: { stepSize: 10 } }
      }
    }
  })
}

// ── Apply Filters ─────────────────────────────────────────
window.applyReportFilters = async function() {
  const gradeFilter = document.getElementById('reportGradeFilter')?.value || ''
  const dateFilter = document.getElementById('reportDateRange')?.value || ''

  // Filter students by grade
  if (gradeFilter) {
    reportData.students = reportData.students.filter(s => s.grade_level === gradeFilter)
  }

  // Here you could add date filtering logic for attendance/grades
  updateSummaryCards()
  renderAllCharts()
}

// ── Export as PDF ─────────────────────────────────────────
window.exportReportPdf = function() {
  const element = document.getElementById('reportsSection')
  const opt = {
    margin: 10,
    filename: 'report.pdf',
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2 },
    jsPDF: { orientation: 'portrait', unit: 'mm', format: 'a4' }
  }
  html2pdf().set(opt).from(element).save()
  showToast('Success', 'Report exported as PDF', 'success')
}

// ── Export as CSV ─────────────────────────────────────────
window.exportReportCsv = function() {
  const wb = XLSX.utils.book_new()

  // Students sheet
  const studentsData = reportData.students.map(s => ({
    'Name': s.name,
    'Grade': s.grade_level || '—',
    'Enrolled': s.created_at ? new Date(s.created_at).toLocaleDateString() : '—'
  }))
  ws = XLSX.utils.json_to_sheet(studentsData)
  XLSX.utils.book_append_sheet(wb, ws, 'Students')

  // Teachers sheet
  const teachersData = reportData.teachers.map(t => ({
    'Name': t.name,
    'Department': t.department || '—',
    'Created': t.created_at ? new Date(t.created_at).toLocaleDateString() : '—'
  }))
  ws = XLSX.utils.json_to_sheet(teachersData)
  XLSX.utils.book_append_sheet(wb, ws, 'Teachers')

  // Summary sheet
  const summaryData = [{
    'Metric': 'Total Students',
    'Value': reportData.students.length
  }, {
    'Metric': 'Total Teachers',
    'Value': reportData.teachers.length
  }, {
    'Metric': 'Total Parents',
    'Value': reportData.parents.length
  }, {
    'Metric': 'Total Attendance Records',
    'Value': reportData.attendance.length
  }]
  ws = XLSX.utils.json_to_sheet(summaryData)
  XLSX.utils.book_append_sheet(wb, ws, 'Summary')

  XLSX.writeFile(wb, 'reports.xlsx')
  showToast('Success', 'Report exported as CSV/Excel', 'success')
}

// ── Print Report ──────────────────────────────────────────
window.printReport = function() {
  window.print()
}

// Expose functions
window.loadReportData = loadReportData
window.updateSummaryCards = updateSummaryCards
window.renderAllCharts = renderAllCharts
