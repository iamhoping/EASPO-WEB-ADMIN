// /js/modules/calendar.js
import { supabase } from '../services/supabaseClient.js'
import { showToast } from '../ui/toast.js'

let currentDate = new Date()
let attendanceData = {}

// Helper function to get the start and end of a month
function getMonthBounds(date) {
  const year = date.getFullYear()
  const month = date.getMonth()
  const start = new Date(year, month, 1).toISOString().slice(0, 10)
  const end = new Date(year, month + 1, 0).toISOString().slice(0, 10)
  return { start, end, year, month }
}

// Fetch attendance data for the current month
async function fetchAttendanceData(date) {
  const bounds = getMonthBounds(date)
  
  try {
    console.log(`Fetching attendance data from ${bounds.start} to ${bounds.end}`)
    
    const { data, error } = await supabase
      .from('attendance')
      .select('date, status')
      .gte('date', bounds.start)
      .lte('date', bounds.end)
      .order('date', { ascending: true })
    
    if (error) {
      console.error('Supabase query error:', error)
      showToast(`Error fetching attendance: ${error.message}`, 'error')
      return {}
    }

    if (!data) {
      console.warn('No data returned from attendance table')
      return {}
    }

    console.log(`Fetched ${data.length} attendance records`)

    // Aggregate attendance by date
    const summary = {}
    data.forEach(item => {
      if (!summary[item.date]) {
        summary[item.date] = { total: 0, present: 0, absent: 0, late: 0 }
      }
      summary[item.date].total++
      if (item.status === 'present') summary[item.date].present++
      else if (item.status === 'absent') summary[item.date].absent++
      else if (item.status === 'late') summary[item.date].late++
    })

    console.log('Attendance data aggregated:', summary)
    return summary
  } catch (error) {
    console.error('Exception in fetchAttendanceData:', error)
    showToast(`Calendar Error: ${error.message}`, 'error')
    return {}
  }
}

// Render the calendar
async function renderCalendar(date) {
  const bounds = getMonthBounds(date)
  attendanceData = await fetchAttendanceData(date)

  const container = document.getElementById('calendarContainer')
  if (!container) return

  const monthYear = document.getElementById('calendarMonthYear')
  if (monthYear) {
    const options = { month: 'long', year: 'numeric' }
    monthYear.textContent = date.toLocaleDateString('en-US', options)
  }

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
  const today = new Date().toISOString().slice(0, 10)
  for (let day = 1; day <= daysInMonth; day++) {
    const dayDate = new Date(bounds.year, bounds.month, day)
    const dateStr = dayDate.toISOString().slice(0, 10)
    const dayEl = document.createElement('div')
    dayEl.className = 'calendar-day'

    // Add status class based on attendance data
    if (attendanceData[dateStr]) {
      const att = attendanceData[dateStr]
      const percentage = (att.present / att.total) * 100

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

    // Mark today
    if (dateStr === today) {
      dayEl.classList.add('today')
    }

    const dayNumber = document.createElement('div')
    dayNumber.className = 'day-number'
    dayNumber.textContent = day
    dayEl.appendChild(dayNumber)

    if (attendanceData[dateStr]) {
      const att = attendanceData[dateStr]
      const statsEl = document.createElement('div')
      statsEl.className = 'day-stats'
      statsEl.innerHTML = `
        <span class="stat-badge present" title="Present">${att.present}</span>
        <span class="stat-badge absent" title="Absent">${att.absent}</span>
        <span class="stat-badge late" title="Late">${att.late}</span>
      `
      dayEl.appendChild(statsEl)
    }

    daysContainer.appendChild(dayEl)
  }

  calendarEl.appendChild(daysContainer)
  container.appendChild(calendarEl)
}

// Navigation functions
export function initCalendar() {
  renderCalendar(currentDate)

  // Expose global functions for navigation
  window.prevMonth = () => {
    currentDate.setMonth(currentDate.getMonth() - 1)
    renderCalendar(new Date(currentDate))
  }

  window.nextMonth = () => {
    currentDate.setMonth(currentDate.getMonth() + 1)
    renderCalendar(new Date(currentDate))
  }

  window.refreshCalendar = () => {
    renderCalendar(new Date(currentDate))
  }

  // Auto-refresh every 5 minutes
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
