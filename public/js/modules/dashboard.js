// /js/modules/dashboard.js
import { supabase } from '../services/supabaseClient.js'
import { showToast } from '../ui/toast.js'

// ── Month range helpers ────────────────────────────────────────
function getMonthRange(monthValue) {
  const d     = monthValue ? new Date(`${monthValue}-01`) : new Date()
  const start = new Date(d.getFullYear(), d.getMonth(), 1)
  const end   = new Date(d.getFullYear(), d.getMonth() + 1, 0)
  return {
    start  : start.toISOString().slice(0,10),
    end    : end.toISOString().slice(0,10),
    labels : Array.from({ length: end.getDate() }, (_, i) => {
      const day = new Date(start.getFullYear(), start.getMonth(), i+1)
      return day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    }),
    dateKeys : Array.from({ length: end.getDate() }, (_, i) => {
      const day = new Date(start.getFullYear(), start.getMonth(), i+1)
      return day.toISOString().slice(0,10)
    })
  }
}

// ── Chart renderer ─────────────────────────────────────────────
function renderLineChart(canvasId, labels, values) {
  const canvas = document.getElementById(canvasId)
  if (!canvas) return
  const ctx    = canvas.getContext('2d')
  const dpr    = window.devicePixelRatio || 1
  const W      = canvas.clientWidth  || 600
  const H      = canvas.clientHeight || 200

  canvas.width  = W * dpr
  canvas.height = H * dpr
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, W, H)

  if (!values.length) return

  const PAD_L = 44, PAD_R = 20, PAD_T = 28, PAD_B = 36
  const chartW = W - PAD_L - PAD_R
  const chartH = H - PAD_T - PAD_B
  const maxVal = 100

  // Resolve CSS variables
  const style   = getComputedStyle(document.documentElement)
  const PRIMARY = style.getPropertyValue('--primary').trim()       || '#38BDF8'
  const GREEN   = style.getPropertyValue('--green').trim()         || '#34D399'
  const SURFACE2= style.getPropertyValue('--surface2').trim()      || '#1A2238'
  const TEXT3   = style.getPropertyValue('--text3').trim()         || '#4E6580'
  const TEXT2   = style.getPropertyValue('--text2').trim()         || '#8FA3BF'

  const toX = i => PAD_L + (chartW / Math.max(values.length - 1, 1)) * i
  const toY = v => PAD_T + chartH * (1 - Math.min(v, maxVal) / maxVal)

  // Grid lines at 0, 25, 50, 75, 100
  ctx.strokeStyle = SURFACE2
  ctx.lineWidth   = 1
  ;[0, 25, 50, 75, 100].forEach(pct => {
    const y = toY(pct)
    ctx.beginPath()
    ctx.setLineDash([4, 4])
    ctx.moveTo(PAD_L, y)
    ctx.lineTo(W - PAD_R, y)
    ctx.stroke()
    ctx.setLineDash([])
    // Y label
    ctx.fillStyle  = TEXT3
    ctx.font       = '11px DM Sans, sans-serif'
    ctx.textAlign  = 'right'
    ctx.textBaseline = 'middle'
    ctx.fillText(pct + '%', PAD_L - 6, y)
  })

  const points = values.map((v, i) => ({ x: toX(i), y: toY(v), v }))

  // Gradient fill under line
  const grad = ctx.createLinearGradient(0, PAD_T, 0, PAD_T + chartH)
  grad.addColorStop(0,   'rgba(56,189,248,.18)')
  grad.addColorStop(1,   'rgba(56,189,248,0)')
  ctx.beginPath()
  ctx.moveTo(points[0].x, PAD_T + chartH)
  points.forEach(p => ctx.lineTo(p.x, p.y))
  ctx.lineTo(points[points.length-1].x, PAD_T + chartH)
  ctx.closePath()
  ctx.fillStyle = grad
  ctx.fill()

  // Line
  ctx.beginPath()
  ctx.strokeStyle = PRIMARY
  ctx.lineWidth   = 2.5
  ctx.lineJoin    = 'round'
  ctx.lineCap     = 'round'
  points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y))
  ctx.stroke()

  // Dots + value labels
  const step = Math.ceil(labels.length / 8)
  points.forEach((p, i) => {
    // Dot
    ctx.beginPath()
    ctx.arc(p.x, p.y, p.v > 0 ? 4 : 2, 0, Math.PI * 2)
    ctx.fillStyle   = p.v > 0 ? PRIMARY : SURFACE2
    ctx.strokeStyle = '#0A0E1A'
    ctx.lineWidth   = 1.5
    ctx.fill()
    if (p.v > 0) ctx.stroke()

    // X labels
    if (i % step === 0 || i === labels.length - 1) {
      ctx.fillStyle    = TEXT3
      ctx.font         = '10px DM Sans, sans-serif'
      ctx.textAlign    = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText(labels[i], p.x, PAD_T + chartH + 8)
    }

    // Value labels on hover sim — show on peaks and endpoints
    if (p.v > 0 && (i === 0 || i === labels.length - 1 || p.v >= Math.max(...values) || p.v <= Math.min(...values.filter(x=>x>0)))) {
      ctx.fillStyle    = TEXT2
      ctx.font         = 'bold 10px DM Sans, sans-serif'
      ctx.textAlign    = 'center'
      ctx.textBaseline = 'bottom'
      ctx.fillText(p.v + '%', p.x, p.y - 6)
    }
  })
}

// ── Load dashboard data ────────────────────────────────────────
export async function loadDashboard(monthValue) {
  const today = new Date().toISOString().slice(0,10)

  // Parallel fetches
  const [
    { count: studentCount },
    { count: teacherCount },
    { count: parentCount  },
    { count: gradeCount   },
    { data:  attToday     },
    { data:  gradeData    },
    { data:  juniorData   },
    { data:  seniorData   },
  ] = await Promise.all([
    supabase.from('profiles').select('*',{count:'exact',head:true}).eq('role','STUDENT'),
    supabase.from('profiles').select('*',{count:'exact',head:true}).eq('role','TEACHER'),
    supabase.from('profiles').select('*',{count:'exact',head:true}).eq('role','PARENT'),
    supabase.from('grades').select('*',{count:'exact',head:true}),
    supabase.from('attendance').select('status').eq('date', today),
    supabase.from('grades').select('score'),
    supabase.from('profiles').select('*',{count:'exact',head:true}).eq('role','STUDENT').in('grade_level',['Grade 7','Grade 8','Grade 9']),
    supabase.from('profiles').select('*',{count:'exact',head:true}).eq('role','STUDENT').in('grade_level',['Grade 10','Grade 11','Grade 12']),
  ]);

  // Stat cards
  setText('totalStudents', studentCount ?? '—')
  setText('totalTeachers', teacherCount ?? '—')
  setText('totalParents',  parentCount  ?? '—')
  setText('totalGrades',   gradeCount   ?? '—')

  // Today's attendance
  const todayRecs  = attToday  || []
  const present    = todayRecs.filter(r => r.status === 'present').length
  const absent     = todayRecs.filter(r => r.status === 'absent').length
  const late       = todayRecs.filter(r => r.status === 'late').length
  const pct        = todayRecs.length > 0 ? Math.round((present / todayRecs.length) * 100) : 0
  setText('presentPercent', pct + '%')
  setText('absentToday',    absent)
  setText('lateToday',      late)

  // Class breakdown
  setText('juniorCount', juniorData?.length ?? juniorData ?? '—')
  setText('seniorCount', seniorData?.length ?? seniorData ?? '—')

  // Avg GWA
  const scores = (gradeData || []).map(g => Number(g.score)).filter(s => !isNaN(s))
  const avg    = scores.length ? (scores.reduce((a,b) => a+b, 0) / scores.length).toFixed(1) : '—'
  setText('avgGwa', avg)

  // Calendar is now handled by initCalendar() - no chart loading needed here
}

// ── Attendance chart ───────────────────────────────────────────
async function loadAttendanceChart(monthValue) {
  const range = getMonthRange(monthValue)

  const { data: histData, error } = await supabase
    .from('attendance')
    .select('date, status')
    .gte('date', range.start)
    .lte('date', range.end)
    .order('date', { ascending: true })

  if (error) {
    console.warn('chart data error:', error.message)
    renderLineChart('attendanceChart', range.labels, Array(range.dateKeys.length).fill(0))
    return
  }

  // Aggregate by date
  const summary = {}
  ;(histData || []).forEach(item => {
    if (!summary[item.date]) summary[item.date] = { total: 0, present: 0 }
    summary[item.date].total++
    if (item.status === 'present') summary[item.date].present++
  })

  const values = range.dateKeys.map(date => {
    const e = summary[date]
    return e ? Math.round((e.present / e.total) * 100) : 0
  })

  renderLineChart('attendanceChart', range.labels, values)
}

// ── Admin profile load ─────────────────────────────────────────
export async function loadAdminProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('name, email, role')
    .eq('id', userId)
    .single()

  if (error || !data) return

  const name = data.name || 'Admin'
  const ini  = name.split(' ').map(w=>w[0]||'').join('').slice(0,2).toUpperCase()

  setText('sidebarName', name)
  setText('sidebarInitials', ini)
  setText('profileInitials', ini)

  const profileName  = document.getElementById('profileName')
  const profileEmail = document.getElementById('profileEmail')
  if (profileName)  profileName.value  = name
  if (profileEmail) profileEmail.value = data.email || ''
}

// ── Init overview section ──────────────────────────────────────
export function initOverviewSection() {
  // Calendar is now initialized separately via initCalendar()
  // No additional setup needed here
}

// ── Helper ─────────────────────────────────────────────────────
function setText(id, val) {
  const el = document.getElementById(id)
  if (el) el.textContent = val ?? '—'
}