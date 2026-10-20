// /js/modules/calendar.js
import { supabase } from '../services/supabaseClient.js'
import { showToast } from '../ui/toast.js'
import {
  getSchoolCalendarEvent,
  isSchoolDay,
  SCHOOL_YEAR_2025_2026
} from './school-calendar-2025-2026.js'

const SCHOOL_YEAR_MONTHS = []
for (let date = new Date(`${SCHOOL_YEAR_2025_2026.startDate}T00:00:00`); date <= new Date(`${SCHOOL_YEAR_2025_2026.displayEndDate}T00:00:00`); date.setMonth(date.getMonth() + 1)) {
  SCHOOL_YEAR_MONTHS.push(new Date(date.getFullYear(), date.getMonth(), 1))
}

let today = getManilaToday()
let currentDate = getInitialCalendarMonth()
let attendanceData = {}
let selectedDate = isSchoolDay(today) && today >= formatLocalDate(new Date(`${SCHOOL_YEAR_2025_2026.startDate}T00:00:00`))
  ? today
  : ''

function formatLocalDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getManilaToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date())
  const part = type => parts.find(item => item.type === type)?.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

function getInitialCalendarMonth() {
  const todayDate = new Date(`${today}T00:00:00`)
  const months = SCHOOL_YEAR_MONTHS
  if (todayDate < months[0]) return new Date(months[0])
  if (todayDate > new Date(`${SCHOOL_YEAR_2025_2026.displayEndDate}T00:00:00`)) return new Date(months[months.length - 1])
  return new Date(todayDate.getFullYear(), todayDate.getMonth(), 1)
}

function getMonthBounds(date) {
  const year = date.getFullYear()
  const month = date.getMonth()
  const start = formatLocalDate(new Date(year, month, 1))
  const end = formatLocalDate(new Date(year, month + 1, 0))
  return { start, end, year, month }
}

async function fetchAttendanceData(date) {
  const bounds = getMonthBounds(date)
  const start = bounds.start < SCHOOL_YEAR_2025_2026.startDate ? SCHOOL_YEAR_2025_2026.startDate : bounds.start
  const end = bounds.end > SCHOOL_YEAR_2025_2026.endDate ? SCHOOL_YEAR_2025_2026.endDate : bounds.end
  if (start > end) return {}

  const [
    { count: totalStudents, error: studentsError },
    { data, error }
  ] = await Promise.all([
    supabase.from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'STUDENT')
      .or('status.is.null,status.neq.archived'),
    supabase.from('attendance')
      .select('student_id, attendance_date, status')
      .gte('attendance_date', start)
      .lte('attendance_date', end)
      .order('attendance_date', { ascending: true })
  ])

  if (studentsError) {
    console.error('Error fetching students count:', studentsError)
    showToast(`Error fetching student count: ${studentsError.message}`, 'error')
    return {}
  }
  if (error) {
    console.error('Supabase attendance query error:', error)
    showToast(`Error fetching attendance: ${error.message}`, 'error')
    return {}
  }

  const summary = {}
  for (const item of data || []) {
    const dateString = item.attendance_date
    if (!dateString || !isSchoolDay(dateString)) continue
    if (!summary[dateString]) {
      summary[dateString] = { total: totalStudents || 0, present: 0, absent: 0, presentSet: new Set() }
    }
    if (String(item.status || '').toLowerCase() === 'present') {
      summary[dateString].presentSet.add(item.student_id)
    }
  }

  Object.keys(summary).forEach(dateString => {
    const daySummary = summary[dateString]
    daySummary.present = daySummary.presentSet.size
    daySummary.absent = Math.max(0, daySummary.total - daySummary.present)
    delete daySummary.presentSet
  })
  return summary
}

async function renderCalendar(date) {
  today = getManilaToday()
  if (selectedDate && (selectedDate < today || !isSchoolDay(selectedDate))) selectedDate = ''
  const bounds = getMonthBounds(date)
  attendanceData = await fetchAttendanceData(date)

  const container = document.getElementById('calendarContainer')
  if (!container) return

  const monthSelect = document.getElementById('calendarMonthSelect')
  if (monthSelect) monthSelect.value = `${bounds.year}-${String(bounds.month + 1).padStart(2, '0')}`

  // Clear container
  container.innerHTML = ''

  // Create calendar structure
  const calendarEl = document.createElement('div')
  calendarEl.className = 'calendar'

  // Weekday headers
  const weekHeader = document.createElement('div')
  weekHeader.className = 'calendar-weekdays'
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  weekdays.forEach(day => {
    const dayEl = document.createElement('div')
    dayEl.className = 'calendar-weekday'
    dayEl.textContent = day
    weekHeader.appendChild(dayEl)
  })
  calendarEl.appendChild(weekHeader)

  // Days
  const daysContainer = document.createElement('div')
  daysContainer.className = 'calendar-days'

  const firstDay = new Date(bounds.year, bounds.month, 1).getDay()
  const daysInMonth = new Date(bounds.year, bounds.month + 1, 0).getDate()

  // Empty cells for days before month starts
  for (let i = 0; i < firstDay; i++) {
    const emptyEl = document.createElement('div')
    emptyEl.className = 'calendar-day empty'
    daysContainer.appendChild(emptyEl)
  }

  // Days of month
  for (let day = 1; day <= daysInMonth; day++) {
    const dayDate = new Date(bounds.year, bounds.month, day)
    const dateStr = formatLocalDate(dayDate)
    const dayEl = document.createElement('div')
    dayEl.className = 'calendar-day'
    const weekend = dayDate.getDay() === 0 || dayDate.getDay() === 6
    const past = dateStr < today
    const outsideSchoolYear = dateStr < SCHOOL_YEAR_2025_2026.startDate || dateStr > SCHOOL_YEAR_2025_2026.endDate
    const event = getSchoolCalendarEvent(dateStr)
    const selectable = !past && isSchoolDay(dateStr)

    if (weekend) dayEl.classList.add('weekend')
    if (past) dayEl.classList.add('past')
    if (outsideSchoolYear) dayEl.classList.add('outside-school-year')
    if (event) dayEl.classList.add(event.type)
    if (attendanceData[dateStr] && isSchoolDay(dateStr)) {
      const att = attendanceData[dateStr]
      const percentage = att.total ? (att.present / att.total) * 100 : 0

      if (percentage === 100) {
        dayEl.classList.add('status-full')
        dayEl.title = `${att.present}/${att.total} Present`
      } else if (percentage >= 75) {
        dayEl.classList.add('status-good')
        dayEl.title = `${att.present}/${att.total} Present (${Math.round(percentage)}%)`
      } else if (percentage >= 50) {
        dayEl.classList.add('status-medium')
        dayEl.title = `${att.present}/${att.total} Present (${Math.round(percentage)}%)`
      } else {
        dayEl.classList.add('status-low')
        dayEl.title = `${att.present}/${att.total} Present (${Math.round(percentage)}%)`
      }
    }

    if (dateStr === today) {
      dayEl.classList.add('today')
    }
    if (dateStr === selectedDate) dayEl.classList.add('selected')
    dayEl.setAttribute('role', 'button')
    dayEl.setAttribute('tabindex', selectable ? '0' : '-1')
    dayEl.setAttribute('aria-disabled', String(!selectable))
    const summary = attendanceData[dateStr]
    const statusLabel = event?.label ||
      (weekend ? 'Weekend — no school-day records'
        : past ? 'Past date — selection disabled'
          : summary ? `${summary.present} of ${summary.total} present`
            : 'No attendance recorded')
    dayEl.setAttribute('aria-label', `${dateStr}: ${statusLabel}${summary ? `; ${summary.present} of ${summary.total} present` : ''}`)
    dayEl.title = statusLabel
    if (selectable) {
      const selectDay = () => {
        if (dateStr < getManilaToday() || !isSchoolDay(dateStr)) {
          selectedDate = ''
          renderCalendar(new Date(currentDate))
          return
        }
        selectedDate = dateStr
        updateCalendarDetail(dateStr)
        daysContainer.querySelectorAll('.calendar-day.selected').forEach(day => day.classList.remove('selected'))
        dayEl.classList.add('selected')
      }
      dayEl.addEventListener('click', selectDay)
      dayEl.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectDay() }
      })
    }

    const dayNumber = document.createElement('div')
    dayNumber.className = 'day-number'
    dayNumber.textContent = day
    dayEl.appendChild(dayNumber)

    const dayMeta = document.createElement('div')
    dayMeta.className = 'day-meta'
    dayMeta.textContent = event
      ? event.type === 'break' ? 'School break' : 'Holiday'
      : weekend ? 'Weekend'
        : outsideSchoolYear ? ''
          : summary
          ? `${summary.present}/${summary.total} · ${summary.total ? Math.round((summary.present / summary.total) * 100) : 0}%`
          : 'No data'
    dayEl.appendChild(dayMeta)

    daysContainer.appendChild(dayEl)
  }

  calendarEl.appendChild(daysContainer)
  container.appendChild(calendarEl)
  if (selectedDate && selectedDate.slice(0, 7) === `${bounds.year}-${String(bounds.month + 1).padStart(2, '0')}`) {
    updateCalendarDetail(selectedDate)
  } else {
    const detail = document.getElementById('calendarDetail')
    if (detail) {
      detail.innerHTML = ''
      detail.classList.add('hidden')
    }
  }
}

function updateCalendarDetail(dateStr) {
  const detail = document.getElementById('calendarDetail')
  if (!detail) return
  detail.classList.remove('hidden')
  const date = new Date(`${dateStr}T00:00:00`)
  const label = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  const summary = attendanceData[dateStr]
  const calendarEvent = getSchoolCalendarEvent(dateStr)
  detail.innerHTML = summary
    ? `<span class="calendar-detail-icon">✓</span><div><strong>${label}</strong><span>${summary.present} present · ${summary.absent} absent · ${summary.total} students tracked</span></div>`
    : `<span class="calendar-detail-icon muted">i</span><div><strong>${label}</strong><span>${calendarEvent?.label || 'No attendance records were recorded for this date.'}</span></div>`
}

export function initCalendar() {
  const monthSelect = document.getElementById('calendarMonthSelect')
  if (monthSelect) {
    monthSelect.innerHTML = SCHOOL_YEAR_MONTHS.map(month => {
      const value = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`
      const label = month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      return `<option value="${value}">${label}</option>`
    }).join('')
    monthSelect.addEventListener('change', () => {
      const selectedMonth = SCHOOL_YEAR_MONTHS.find(month => {
        const value = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`
        return value === monthSelect.value
      })
      if (!selectedMonth) {
        monthSelect.value = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`
        return
      }
      currentDate = new Date(selectedMonth)
      selectedDate = ''
      renderCalendar(new Date(currentDate))
    })
  }

  renderCalendar(currentDate)

  document.getElementById('todayMonthBtn')?.addEventListener('click', () => {
    today = getManilaToday()
    currentDate = getInitialCalendarMonth()
    selectedDate = isSchoolDay(today) ? today : ''
    renderCalendar(new Date(currentDate))
  })
  document.getElementById('refreshCalendarBtn')?.addEventListener('click', () => renderCalendar(new Date(currentDate)))

  window.refreshCalendar = () => {
    renderCalendar(new Date(currentDate))
  }

  setInterval(window.refreshCalendar, 5 * 60 * 1000)
}

export async function updateCalendarData() {
  await renderCalendar(currentDate)
}

export default {
  initCalendar,
  updateCalendarData,
  renderCalendar
}
