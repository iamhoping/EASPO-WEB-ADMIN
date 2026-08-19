// /js/modules/scanner-attendance.js
import { supabase } from '../services/supabaseClient.js'

const SCAN_TIMEOUT = 700
const SCANNER_IDLE_TIMEOUT = 15000

let scanBuffer = ''
let scanTimer = null
let idleTimer = null
let initialized = false
let processing = false

function getElement(id) {
  return document.getElementById(id)
}

function setText(id, value) {
  const element = getElement(id)
  if (element) element.textContent = value || '—'
}

function setScannerState(message, type = 'ready') {
  setText('scannerStatus', message)
  const indicator = getElement('scannerIndicator')
  if (indicator) {
    indicator.className = `scanner-indicator ${type}`
    indicator.setAttribute('aria-label', `Scanner ${type}`)
  }
}

function isAttendanceSectionActive() {
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
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function formatAttendanceTime(date) {
  return date.toTimeString().slice(0, 8)
}

function getErrorMessage(error) {
  if (!error) return 'Unknown Supabase error'
  const details = [error.message, error.code, error.details, error.hint].filter(Boolean)
  return details.join(' | ')
}

function getStudentIdCandidates(scannedValue) {
  const value = scannedValue.trim()
  const lowerPrefix = value.match(/^std[\/:](.+)$/i)
  const token = lowerPrefix ? lowerPrefix[1].trim() : value
  const candidates = [value, value.toUpperCase(), token, token.toUpperCase(), `STD-${token.toUpperCase()}`]
  return [...new Set(candidates.filter(Boolean))]
}

function showResult(student, sectionName, scannedAt) {
  const result = getElement('scannerResult')
  if (!result) return

  result.classList.remove('hidden', 'scanner-result-error', 'scanner-result-duplicate')
  setText('scannerResultTitle', 'Attendance Recorded')
  setText('scannerStudentName', student.name)
  setText('scannerStudentId', `Student ID: ${student.student_id}`)
  setText('scannerStudentClass', `${student.grade_level || 'No grade'} - ${sectionName}`)
  setText('scannerResultStatus', 'Present')
  setText('scannerScannedAt', formatScanTime(scannedAt))
}

function showErrorResult(title, message, duplicate = false) {
  const result = getElement('scannerResult')
  if (!result) return

  result.classList.remove('hidden', 'scanner-result-error', 'scanner-result-duplicate')
  result.classList.add(duplicate ? 'scanner-result-duplicate' : 'scanner-result-error')
  setText('scannerResultTitle', title)
  setText('scannerStudentName', message)
  setText('scannerStudentId', '')
  setText('scannerStudentClass', '')
  setText('scannerResultStatus', '')
  setText('scannerScannedAt', '')
}

async function recordScan(rawValue) {
  const scannedValue = rawValue.trim()
  console.log('Scanned QR:', scannedValue)
  console.log('[SCANNER] QR received', { value: scannedValue })

  if (!scannedValue) {
    setScannerState('Empty scan ignored', 'error')
    return
  }

  processing = true
  setScannerState('Looking up student...', 'busy')
  armScannerIdleTimer()

  try {
    const { data: { user } = {}, error: authError } = await supabase.auth.getUser()
    console.log('[AUTH] Current user:', user)
    console.error('[AUTH] User lookup error:', authError)
    if (authError) throw authError
    if (!user) throw new Error('No authenticated user. Please sign in again.')

    const exactLookup = await supabase
      .from('profiles')
      .select('id, student_id, name, grade_level, section_id')
      .eq('student_id', scannedValue)
      .eq('role', 'STUDENT')
      .maybeSingle()

    let student = exactLookup.data
    let studentError = exactLookup.error
    console.log('Student lookup:', student)
    console.error('Student lookup error:', studentError)
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
      console.error('[STUDENT] Normalized lookup error:', studentError)
      if (studentError) throw studentError
    }

    if (!student) {
      console.error('[STUDENT] Student not found', { scannedValue })
      showErrorResult('Student Not Found', `No student matches QR value "${scannedValue}".`)
      setScannerState('Scan another student', 'error')
      return
    }
    console.log('[STUDENT] Student found', student)

    let sectionName = 'No section assigned'
    let section = null
    if (student.section_id) {
      const { data, error: sectionError } = await supabase
        .from('sections')
        .select('name')
        .eq('id', student.section_id)
        .maybeSingle()

      section = data
      console.log('Section:', section)
      console.error('Section lookup error:', sectionError)
      if (sectionError) throw sectionError
      sectionName = section?.name || 'Section not found'
    } else {
      console.log('Section:', section)
    }
    console.log('[SECTION] Section found', { sectionId: student.section_id || null, sectionName })

    const scannedAt = new Date()
    const attendanceDate = scannedAt.toISOString().slice(0, 10)
    const timeIn = formatAttendanceTime(scannedAt)
    console.log('[ATTENDANCE] Checking duplicate', {
      studentId: student.id,
      attendanceDate
    })
    const { data: existing, error: existingError } = await supabase
      .from('attendance')
      .select('student_id, status, attendance_date')
      .eq('student_id', student.id)
      .eq('attendance_date', attendanceDate)
      .maybeSingle()

    console.log('[ATTENDANCE] Duplicate check result', existing)
    console.error('[ATTENDANCE] Duplicate check error:', existingError)
    if (existingError) throw existingError
    if (existing) {
      console.log('[ATTENDANCE] Already marked present', existing)
      showErrorResult('Already Marked Present', `${student.name} already has attendance for today.`, true)
      setScannerState('Ready for next scan', 'duplicate')
      return
    }

    console.log('[ATTENDANCE] Inserting record', {
      student_id: student.id,
      attendance_date: attendanceDate,
      time_in: timeIn,
      status: 'present'
    })
    const { data: attendance, error: insertError } = await supabase
      .from('attendance')
      .insert([{ student_id: student.id, status: 'present', attendance_date: attendanceDate, time_in: timeIn }])
      .select()
      .single()

    console.log('Attendance result:', attendance)
    console.error('Attendance insert error:', insertError)
    if (insertError) throw insertError

    console.log('[ATTENDANCE] Insert successful', attendance)
    showResult(student, sectionName, scannedAt)
    document.dispatchEvent(new CustomEvent('scanner-attendance-recorded'))
    setScannerState('Attendance recorded - ready for next scan', 'success')
  } catch (error) {
    const message = getErrorMessage(error)
    console.error('[SCANNER] Flow failed', error)
    showErrorResult('Attendance Error', message)
    setScannerState('Database error - scan again', 'error')
  } finally {
    processing = false
    armScannerIdleTimer()
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

  scanBuffer += event.key
  setScannerState('Scanning...', 'busy')
  if (scanTimer) clearTimeout(scanTimer)
  scanTimer = setTimeout(submitScanBuffer, SCAN_TIMEOUT)
}

export function initScannerAttendance() {
  if (initialized || !getElement('scannerAttendancePanel')) return
  initialized = true
  document.addEventListener('keydown', handleScannerKeydown)
  setScannerState('Ready to scan', 'ready')
  armScannerIdleTimer()
}
