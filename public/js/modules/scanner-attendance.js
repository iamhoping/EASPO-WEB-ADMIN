// /js/modules/scanner-attendance.js
import { supabase } from '../services/supabaseClient.js'

const SCAN_TIMEOUT = 700
const SCANNER_IDLE_TIMEOUT = 15000

let scanBuffer = ''
let scanTimer = null
let idleTimer = null
let initialized = false
let processing = false
let scannerState = 'READY'

function getElement(id) {
  return document.getElementById(id)
}

function setText(id, value) {
  const element = getElement(id)
  if (element) element.textContent = value ?? '—'
}

function setScannerState(message, type = 'ready') {
  scannerState = type === 'busy' ? (message === 'Scanning...' ? 'SCANNING' : 'PROCESSING') : type.toUpperCase()
  setText('scannerStatus', message)
  const indicator = getElement('scannerIndicator')
  if (indicator) {
    indicator.className = `scanner-indicator ${type}`
    indicator.setAttribute('aria-label', `Scanner ${type}`)
  }
}

function isAttendanceSectionActive() {
  const scannerPage = getElement('scannerPage')
  if (scannerPage) return true
  const section = getElement('attendanceSection')
  return section && !section.classList.contains('hidden')
}

function resetScanBuffer() {
  scanBuffer = ''
  if (scanTimer) clearTimeout(scanTimer)
  scanTimer = null
}

function submitScanBuffer() {
  const value = scanBuffer.trim()
  resetScanBuffer()
  if (value) recordScan(value)
}

function armScannerIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    if (!processing && isAttendanceSectionActive()) setScannerState('No scan received recently', 'idle')
  }, SCANNER_IDLE_TIMEOUT)
}

function formatScanTime(date) {
  return date.toLocaleTimeString('en-US', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit', second: '2-digit' })
}

function schoolDateParts(date) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'long'
  }).formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value]))
}

function formatAttendanceTime(date) {
  const parts = schoolDateParts(date)
  return `${parts.hour}:${parts.minute}:${parts.second}`
}

function formatLocalDate(date) {
  const parts = schoolDateParts(date)
  return `${parts.year}-${parts.month}-${parts.day}`
}

function isLateForSchedule(schedule, scannedAt) {
  const start = String(scheduleValue(schedule, ['start_time', 'time_start', 'start']) || '00:00')
  const [hour = '0', minute = '0'] = start.split(':')
  const parts = schoolDateParts(scannedAt)
  return Number(parts.hour) * 60 + Number(parts.minute) > Number(hour) * 60 + Number(minute)
}

function getStudentIdCandidates(scannedValue) {
  const value = scannedValue.trim()
  const lowerPrefix = value.match(/^std[\/:](.+)$/i)
  const token = lowerPrefix ? lowerPrefix[1].trim() : value
  const candidates = [value, value.toUpperCase(), token, token.toUpperCase(), `STD-${token.toUpperCase()}`]
  return [...new Set(candidates.filter(Boolean))]
}

function showResult(student, sectionName, subjectName, scannedAt) {
  const result = getElement('scannerResult')
  if (!result) return

  result.classList.remove('hidden', 'scanner-result-error', 'scanner-result-duplicate')
  setText('scannerResultTitle', 'Attendance Recorded Successfully')
  setText('scannerStudentName', student.name)
  setText('scannerStudentId', `Student ID: ${student.student_id}`)
  setText('scannerStudentClass', `${student.grade_level || 'No grade'} - ${sectionName}`)
  setText('scannerSubject', `Subject: ${subjectName || '—'}`)
  setText('scannerResultStatus', 'Present')
  setText('scannerScannedAt', formatScanTime(scannedAt))
}

function showErrorResult(title, message, duplicate = false) {
  const result = getElement('scannerResult')
  if (!result) return

  result.classList.remove('hidden', 'scanner-result-error', 'scanner-result-duplicate', 'scanner-result-info')
  result.classList.add(duplicate ? 'scanner-result-duplicate' : 'scanner-result-error')
  setText('scannerResultTitle', title)
  setText('scannerStudentName', message)
  setText('scannerStudentId', '')
  setText('scannerStudentClass', '')
  setText('scannerSubject', '')
  setText('scannerResultStatus', '')
  setText('scannerScannedAt', '')
}

function finishResult(state) {
  setScannerState(state === 'DUPLICATE' ? 'Already Scanned' : state === 'NO_SCHEDULE' ? 'No Schedule Today' : state === 'NOT_FOUND' ? 'Student Not Found' : state === 'ERROR' ? 'System Error' : 'Ready to Scan', state.toLowerCase())
}

function showNoScheduleResult(student) {
  const result = getElement('scannerResult')
  showErrorResult('No Schedule Today', `${student.name} does not have an attendance schedule today. Attendance was not recorded.`)
  result?.classList.remove('scanner-result-error')
  result?.classList.add('scanner-result-info')
}

function scheduleValue(schedule, keys) {
  for (const key of keys) {
    if (schedule?.[key] !== undefined && schedule[key] !== null && schedule[key] !== '') return schedule[key]
  }
  return null
}

function normalizeDay(value) {
  return String(value || '').trim().toLowerCase().slice(0, 3)
}

function scheduleIsToday(schedule, date, day) {
  const scheduleDate = scheduleValue(schedule, ['schedule_date', 'date', 'scheduled_date'])
  const scheduleDay = scheduleValue(schedule, ['day_of_week', 'day', 'weekday'])
  return (scheduleDate || scheduleDay) &&
    (!scheduleDate || String(scheduleDate).slice(0, 10) === date) &&
    (!scheduleDay || normalizeDay(scheduleDay) === normalizeDay(day))
}

function scheduleMatchesStudent(schedule, student) {
  const scheduleStudent = scheduleValue(schedule, ['student_id', 'profile_id'])
  const scheduleSection = scheduleValue(schedule, ['section_id', 'section'])
  const hasStudentOrSection = scheduleStudent !== null || scheduleSection !== null
  return hasStudentOrSection &&
    (!scheduleStudent || String(scheduleStudent) === String(student.id)) &&
    (!scheduleSection || String(scheduleSection) === String(student.section_id))
}

async function findTodaySchedule(student, date, day) {
  const { data: schedules, error } = await supabase.from('schedules').select('*')
  if (error) throw error
  const matchingSchedules = (schedules || []).filter(candidate => {
    const status = String(candidate.status || '').toLowerCase()
    return candidate.active !== false && !['inactive', 'cancelled', 'canceled'].includes(status) &&
      scheduleIsToday(candidate, date, day) && scheduleMatchesStudent(candidate, student)
  })
  const schedule = matchingSchedules.sort((left, right) => {
    const leftStart = String(scheduleValue(left, ['start_time', 'time_start', 'start']) || '00:00')
    const rightStart = String(scheduleValue(right, ['start_time', 'time_start', 'start']) || '00:00')
    return leftStart.localeCompare(rightStart) || String(left.id || '').localeCompare(String(right.id || ''))
  })[0]
  console.log('[SCHEDULE] Today\'s schedule:', schedule || null)
  console.log('[SCHEDULE] Eligible:', Boolean(schedule))
  return schedule
}

function resetResult() {
  getElement('scannerResult')?.classList.add('hidden')
  setScannerState('Ready to Scan', 'ready')
}

async function recordScan(rawValue) {
  if (processing) return
  const scannedValue = rawValue.trim().replace(/\r/g, '').replace(/\n/g, '').replace(/\s+/g, '')
  console.log('[SCANNER] Raw scan:', rawValue)
  console.log('[SCANNER] Normalized scan:', scannedValue)

  if (!scannedValue) {
    setScannerState('Empty scan ignored', 'error')
    return
  }

  processing = true
  scannerState = 'PROCESSING'
  setScannerState('Looking up student...', 'busy')
  armScannerIdleTimer()

  try {
    const exactLookup = await supabase
      .from('profiles')
      .select('id, student_id, name, grade_level, section_id')
      .eq('student_id', scannedValue)
      .eq('role', 'STUDENT')
      .maybeSingle()

    let student = exactLookup.data
    let studentError = exactLookup.error
    console.log('[STUDENT] Lookup:', student)
    if (studentError) throw studentError

    if (!student) {
      const candidates = getStudentIdCandidates(scannedValue)
      console.log('[STUDENT] Exact ID not found; trying normalized candidates', candidates)
      const normalizedLookup = await supabase
        .from('profiles')
        .select('id, student_id, name, grade_level, section_id')
        .in('student_id', candidates)
        .eq('role', 'STUDENT')
        .maybeSingle()

      student = normalizedLookup.data
      studentError = normalizedLookup.error
      console.log('[STUDENT] Normalized lookup:', student)
      if (studentError) throw studentError
    }

    if (!student) {
      console.error('[STUDENT] Student not found', { scannedValue })
      showErrorResult('Student Not Found', 'The scanned student ID is not registered. Attendance was not recorded.')
      finishResult('NOT_FOUND')
      return
    }
    console.log('[STUDENT] Found:', student)

    if (!student.section_id) throw new Error('Student has no valid section.')
    const { data: section, error: sectionError } = await supabase
        .from('sections')
        .select('name')
        .eq('id', student.section_id)
        .maybeSingle()
    console.log('[SECTION] Lookup:', section)
    if (sectionError || !section?.name) throw sectionError || new Error('Section not found.')
    const sectionName = section.name
    console.log('[SECTION] Found:', sectionName)

    const scannedAt = new Date()
    const attendanceDate = formatLocalDate(scannedAt)
    const timeIn = formatAttendanceTime(scannedAt)
    const todaySchedule = await findTodaySchedule(student, attendanceDate, schoolDateParts(scannedAt).weekday)
    if (!todaySchedule) {
      showNoScheduleResult(student)
      finishResult('NO_SCHEDULE')
      return
    }
    const scheduleId = scheduleValue(todaySchedule, ['id', 'schedule_id'])
    const subjectName = scheduleValue(todaySchedule, ['subject_name', 'subject', 'subject_title', 'subject_code']) || '—'
    console.log('[ATTENDANCE] Checking for existing record:', {
      studentId: student.id,
      scheduleId,
      attendanceDate
    })
    const duplicateQuery = supabase
      .from('attendance')
      .select('*')
      .eq('student_id', student.id)
      .eq('attendance_date', attendanceDate)
    const { data: attendanceRows, error: existingError } = await duplicateQuery

    const existing = (attendanceRows || []).find(row => String(row.schedule_id) === String(scheduleId))
    console.log('[ATTENDANCE] Existing record check result:', existing || null)
    if (existingError) throw existingError

    // Determine if this is a late scan (updating Absent to Present)
    let isLate = isLateForSchedule(todaySchedule, scannedAt)
    let attendance = null
    let insertError = null

    if (existing) {
      if (existing.status === 'present') {
        // Already scanned as present
        console.log('[ATTENDANCE] Already marked present', existing)
        showErrorResult('Already Scanned', `${student.name} has already been marked present for this schedule. No duplicate was created.`, true)
        setText('scannerScannedAt', `Time In: ${existing.time_in || 'Recorded'}`)
        finishResult('DUPLICATE')
        processing = false
        armScannerIdleTimer()
        return
      } else if (existing.status === 'absent') {
        // Late scan - update Absent to Present
        console.log('[ATTENDANCE] Late scan detected - updating Absent to Present', existing)
        isLate = true
        const updateData = {
          status: 'present',
          time_in: timeIn,
          is_late: true,
          guardian_email_sent: existing.guardian_email_sent || false
        }
        const { data: updatedAttendance, error: updateError } = await supabase
          .from('attendance')
          .update(updateData)
          .eq('id', existing.id)
          .select()
          .single()

        attendance = updatedAttendance
        insertError = updateError
        console.log('[ATTENDANCE] Late scan update result:', attendance)
      } else {
        // Other status - still create new or handle as needed
        console.log('[ATTENDANCE] Existing record with status:', existing.status)
        showErrorResult('Conflicting Record', `A record with status "${existing.status}" exists for this student. Please contact an administrator.`)
        finishResult('ERROR')
        processing = false
        armScannerIdleTimer()
        return
      }
    } else {
      // Create new Present record
      const attendanceRecord = {
        student_id: student.id,
        section_id: student.section_id,
        schedule_id: scheduleId,
        subject: subjectName,
        attendance_date: attendanceDate,
        time_in: timeIn,
        status: 'present',
        is_late: isLate,
        guardian_email_sent: false
      }
      console.log('[ATTENDANCE] Insert:', attendanceRecord)
      const result = await supabase
        .from('attendance')
        .insert([attendanceRecord])
        .select()
        .single()

      attendance = result.data
      insertError = result.error
      console.log('[ATTENDANCE] New record result:', attendance)
    }

    console.error('[ATTENDANCE] Potential error:', insertError)
    if (insertError) throw insertError

    console.log('[ATTENDANCE] Success:', attendance)
    if (isLate) {
      // Show late arrival message
      const resultDiv = getElement('scannerResult')
      if (resultDiv) {
        resultDiv.classList.remove('hidden', 'scanner-result-error', 'scanner-result-duplicate', 'scanner-result-info')
        setText('scannerResultTitle', 'Late Arrival Recorded')
        setText('scannerStudentName', student.name)
        setText('scannerStudentId', `Student ID: ${student.student_id}`)
        setText('scannerStudentClass', `${student.grade_level || 'No grade'} - ${sectionName}`)
        setText('scannerSubject', `Subject: ${subjectName || '—'}`)
        setText('scannerResultStatus', 'Late')
        setText('scannerScannedAt', formatScanTime(scannedAt))
        setScannerState('Late Arrival', 'success')
      }
    } else {
      showResult(student, sectionName, subjectName, scannedAt)
      setScannerState('Ready to Scan', 'success')
    }
    document.dispatchEvent(new CustomEvent('scanner-attendance-recorded'))
  } catch (error) {
    console.error('[SCANNER] Flow failed:', error)
    showErrorResult('System Error', 'Unable to record attendance. Please try scanning again.')
    finishResult('ERROR')
  } finally {
    processing = false
    armScannerIdleTimer()
    console.log('[SCANNER] Flow complete:', scannerState)
  }
}

function handleScannerKeydown(event) {
  if (!isAttendanceSectionActive()) return
  if (event.ctrlKey || event.altKey || event.metaKey) return

  if (event.key === 'Enter') {
    event.preventDefault()
    submitScanBuffer()
    return
  }

  if (event.key.length !== 1) return

  if (!processing && !scanBuffer) resetResult()
  scanBuffer += event.key
  setScannerState('Scanning...', 'busy')
  if (scanTimer) clearTimeout(scanTimer)
  scanTimer = setTimeout(submitScanBuffer, SCAN_TIMEOUT)
}

export function initScannerAttendance() {
  if (initialized || (!getElement('scannerAttendancePanel') && !getElement('scannerPage'))) return
  initialized = true
  document.addEventListener('keydown', handleScannerKeydown)
  setScannerState('Ready to Scan', 'ready')
  armScannerIdleTimer()
}
