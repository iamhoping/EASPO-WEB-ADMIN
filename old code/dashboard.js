// /js/dashboard.js

import { supabase } from './supabaseClient.js'

/**
 * 📊 Get dashboard counts for students and teachers
 */
export async function getDashboardCounts() {
  console.log('📊 Fetching dashboard counts...')
  
  // Count Students
  const { count: studentCount, error: studentError } = await supabase
    .from('profiles')
    .select('*', { count: 'exact', head: true })
    .eq('role', 'STUDENT')

  // Count Teachers
  const { count: teacherCount, error: teacherError } = await supabase
    .from('profiles')
    .select('*', { count: 'exact', head: true })
    .eq('role', 'TEACHER')

  if (studentError) console.error('❌ Student Error:', studentError.message)
  if (teacherError) console.error('❌ Teacher Error:', teacherError.message)
  
  console.log(`✅ Students: ${studentCount}, Teachers: ${teacherCount}`)
  
  // Update your HTML elements with these numbers
  const totalStudentsEl = document.getElementById('totalStudents')
  const totalTeachersEl = document.getElementById('totalTeachers')
  
  if (totalStudentsEl) totalStudentsEl.innerText = studentCount || 0
  if (totalTeachersEl) totalTeachersEl.innerText = teacherCount || 0
}

/**
 * 📅 Calculate month date range
 * Returns start, end dates and formatted labels for a given month
 * @param {string} monthValue - Month in YYYY-MM format (or empty for current)
 * @returns {object} Object with start, end dates and label array
 */
function getMonthRange(monthValue) {
  const now = monthValue ? new Date(`${monthValue}-01`) : new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    labels: Array.from({ length: end.getDate() }, (_, i) => {
      const d = new Date(start.getFullYear(), start.getMonth(), i + 1)
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    })
  }
}

/**
 * 🗓️ Format date to YYYY-MM-DD
 * @param {Date} date - JavaScript Date object
 * @returns {string} Formatted date string
 */
function formatDateForKey(date) {
  return date.toISOString().slice(0, 10)
}

/**
 * 📊 Create array of date keys between start and end
 * Generates all dates in a range for attendance mapping
 * @param {string} start - Start date in YYYY-MM-DD
 * @param {string} end - End date in YYYY-MM-DD
 * @returns {array} Array of date strings
 */
function createDateKeys(start, end) {
  const keys = []
  let current = new Date(start)
  const last = new Date(end)
  while (current <= last) {
    keys.push(formatDateForKey(current))
    current.setDate(current.getDate() + 1)
  }
  return keys
}

/**
 * 📈 Render line chart on canvas
 * Draws attendance percentage trend with points and labels
 * @param {string} canvasId - Canvas element ID
 * @param {array} labels - X-axis labels (dates)
 * @param {array} values - Y-axis values (percentages)
 */
function renderLineChart(canvasId, labels, values) {
  const canvas = document.getElementById(canvasId)
  const ctx = canvas.getContext('2d')
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  
  // Set canvas resolution for crisp rendering
  canvas.width = width * window.devicePixelRatio
  canvas.height = height * window.devicePixelRatio
  ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0)

  // Clear canvas and set styling
  ctx.clearRect(0, 0, width, height)
  ctx.strokeStyle = '#10B981'
  ctx.fillStyle = '#10B981'
  ctx.lineWidth = 3
  ctx.font = '12px Inter, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'

  // Calculate chart dimensions and scale
  const padding = 40
  const chartWidth = width - padding * 2
  const chartHeight = height - padding * 2
  const maxValue = Math.max(100, ...values)

  // Map values to canvas coordinates
  const points = values.map((value, idx) => {
    const x = padding + (chartWidth * idx) / (values.length - 1 || 1)
    const y = padding + chartHeight * (1 - value / maxValue)
    return { x, y, value }
  })

  // Draw line connecting all points
  ctx.beginPath()
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y)
    else ctx.lineTo(point.x, point.y)
  })
  ctx.stroke()

  // Draw circular points on line
  ctx.fillStyle = '#10B981'
  points.forEach(point => {
    ctx.beginPath()
    ctx.arc(point.x, point.y, 4, 0, Math.PI * 2)
    ctx.fill()
  })

  // Draw value labels and date labels
  ctx.fillStyle = '#374151'
  points.forEach((point, idx) => {
    ctx.fillText(`${point.value}%`, point.x, point.y - 18)
    if (idx % Math.ceil(labels.length / 6) === 0 || idx === labels.length - 1) {
      ctx.fillText(labels[idx], point.x, height - padding + 8)
    }
  })
}

/**
 * 📊 Load dashboard data and render UI
 * Fetches user profile, counts, attendance data and renders charts
 * @param {string} monthValue - Selected month in YYYY-MM format
 */
export async function loadDashboard(monthValue) {
  // 🔐 Check if user is logged in
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) {
    console.log("No user logged in, redirecting...")
    window.location.href = 'index.html'
    return
  }

  // 👤 Fetch admin profile data
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('name, role')
    .eq('id', user.id)
    .single()

  if (profileError) {
    console.error("Error fetching profile:", profileError.message)
    return
  }

  // Set admin name in welcome message
  const adminNameEl = document.getElementById('adminName')
  if (adminNameEl) adminNameEl.innerText = profile.name

  // 👨‍🎓 Count total students
  const { count: studentCount } = await supabase
    .from('profiles')
    .select('*', { count: 'exact', head: true })
    .eq('role', 'STUDENT')

  // 👩‍🏫 Count total teachers
  const { count: teacherCount } = await supabase
    .from('profiles')
    .select('*', { count: 'exact', head: true })
    .eq('role', 'TEACHER')

  const totalStudentsEl = document.getElementById('totalStudents')
  const totalTeachersEl = document.getElementById('totalTeachers')
  
  if (totalStudentsEl) totalStudentsEl.innerText = studentCount || 0
  if (totalTeachersEl) totalTeachersEl.innerText = teacherCount || 0

  // 📅 Calculate attendance percentage for today
  const today = new Date().toISOString().slice(0, 10)
  const { data: attendanceToday, error: attError } = await supabase
    .from('attendance')
    .select('status')
    .eq('attendance_date', today)

  if (attError) {
    console.error("Error fetching today's attendance:", attError.message)
    const presentPercentEl = document.getElementById('presentPercent')
    if (presentPercentEl) presentPercentEl.innerText = '0%'
  } else {
    const present = (attendanceToday || []).filter(a => a.status === 'present').length
    const percent = attendanceToday && attendanceToday.length > 0
      ? Math.round((present / attendanceToday.length) * 100)
      : 0
    const presentPercentEl = document.getElementById('presentPercent')
    if (presentPercentEl) presentPercentEl.innerText = percent + '%'
  }

  // 📊 Fetch historical attendance data for selected month
  const range = getMonthRange(monthValue)
  const dateKeys = createDateKeys(range.start, range.end)
  const { data: attendanceHistory, error: histError } = await supabase
    .from('attendance')
    .select('attendance_date, status')
    .gte('attendance_date', range.start)
    .lte('attendance_date', range.end)
    .order('attendance_date', { ascending: true })

  if (histError) {
    console.error("Error fetching attendance history:", histError.message)
    renderLineChart('attendanceChart', dateKeys.map((d) => d.slice(5).replace('-', '/')), Array(dateKeys.length).fill(0))
    return
  }

  // 🧮 Aggregate attendance data by date
  const summary = {}
  attendanceHistory.forEach(item => {
    const dt = item.attendance_date || item.date
    summary[dt] = summary[dt] || { total: 0, present: 0 }
    summary[dt].total += 1
    if (item.status === 'present') summary[dt].present += 1
  })

  // 📈 Calculate percentages and render chart
  const values = dateKeys.map(date => {
    const entry = summary[date]
    return entry ? Math.round((entry.present / entry.total) * 100) : 0
  })

  renderLineChart('attendanceChart', dateKeys.map(date => date.slice(5).replace('-', '/')), values)
}