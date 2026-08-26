// /js/admin.js
// ─────────────────────────────────────────────────────────────
//  SchoolSys Admin — Main Entry Point
//  Imports all modules, handles auth guard, section routing,
//  real-time subscriptions and global function exposure.
// ─────────────────────────────────────────────────────────────

import { supabase }          from './services/supabaseClient.js'
import { logout }            from './services/auth.js'
import { showToast }         from './ui/toast.js'

// Modules
import {
  initOverviewSection,
  loadDashboard,
  loadAdminProfile,
  setProfileAvatar,
} from './modules/dashboard.js'

import { initCalendar } from './modules/calendar.js'

import {
  initStudentsSection,
  loadStudents,
  generateStudentId,
  submitAddStudent,
  openEditStudentModal,
  submitEditStudent,
} from './modules/students.js'

import {
  initTeachersSection,
  loadTeachers,
  generateTeacherId,
  submitAddTeacher,
  openEditTeacherModal,
  submitEditTeacher,
} from './modules/teachers.js'

import {
  initParentsSection,
  loadParents,
  generateParentId,
  submitAddParent,
  openEditParentModal,
  submitEditParent,
} from './modules/parents.js'

import {
  initAttendanceSection,
  loadAttendance,
  submitManualEntry,
  bulkMarkAttendance,
} from './modules/attendance.js'

import { initScannerAttendance } from './modules/scanner-attendance.js'

import {
  initGradesSection,
  loadGrades,
  submitAddGrade,
  openEditGradeModal,
} from './modules/grades.js'

import {
  initReportsSection,
} from './modules/reports.js'

import {
  initUserManagementSection,
  loadUserManagement,
} from './modules/user-management.js'

import { renderPagination } from './ui/pagination.js';

function renderStudents(page = 1) {
  console.log('Students page:', page);

  renderPagination(
    'studentsPagination',
    page,
    10,
    renderStudents
  );
}

document.addEventListener('DOMContentLoaded', () => {
  renderStudents();
});

// ── Auth Guard ────────────────────────────────────────────────
async function authGuard() {
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) {
    window.location.href = 'index.html'
    return null
  }

  // Verify WEB_ADMIN role
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, name, email')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'WEB_ADMIN') {
    await supabase.auth.signOut()
    window.location.href = 'index.html'
    return null
  }

  return { user, profile }
}

// ── Section Config ────────────────────────────────────────────
const SECTIONS = {
  overview   : { id: 'overviewSection',   title: 'Admin Dashboard',       sub: 'Overview of your school system' },
  students   : { id: 'studentsSection',   title: 'Manage Students',       sub: 'Create, edit and manage student records' },
  teachers   : { id: 'teachersSection',   title: 'Manage Teachers',       sub: 'Manage faculty records and assignments' },
  parents    : { id: 'parentsSection',    title: 'Parents Management',    sub: 'Manage parent and guardian records' },
  attendance : { id: 'attendanceSection', title: 'Attendance Logs',       sub: 'Real-time tracking with manual override' },
  grades     : { id: 'gradesSection',     title: 'Grade Records',         sub: 'Manage student academic performance' },
  reports    : { id: 'reportsSection',    title: 'Analytics & Reports',   sub: 'View comprehensive dashboards and analytics' },
  userManagement: { id: 'userManagementSection', title: 'User Management', sub: 'Manage user accounts and password resets' },
}

let activeSection = 'overview'
let settingsUser = null
let pendingTwoFactor = null

async function saveAdminProfile() {
  const name = document.getElementById('profileName')?.value.trim() || ''
  const email = document.getElementById('profileEmail')?.value.trim() || ''
  const button = document.getElementById('updateProfileBtn')

  if (!name || !email) return showToast('Profile not saved', 'Full name and email are required.', 'warning')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showToast('Profile not saved', 'Enter a valid email address.', 'warning')
  if (!settingsUser?.id) return showToast('Profile not saved', 'Could not identify the current admin account.', 'error')

  const originalText = button?.textContent || 'Update Profile'
  if (button) {
    button.disabled = true
    button.textContent = 'Saving...'
  }

  try {
    const { error: profileError } = await supabase
      .from('profiles')
      .update({ name, email })
      .eq('id', settingsUser.id)
    if (profileError) throw profileError

    if (email !== settingsUser.email) {
      const { error: authError } = await supabase.auth.updateUser({ email })
      if (authError) throw authError
    }

    settingsUser = { ...settingsUser, email, name }
    await loadAdminProfile(settingsUser.id)
    showToast('Profile updated', 'Your profile information was saved successfully.', 'success')
  } catch (error) {
    showToast('Profile not saved', error.message || 'Could not update your profile.', 'error')
  } finally {
    if (button) {
      button.disabled = false
      button.textContent = originalText
    }
  }
}

async function uploadProfilePhoto(file) {
  if (!file || !settingsUser?.id) return
  if (!file.type.startsWith('image/')) return showToast('Photo not uploaded', 'Choose a PNG, JPG, or WebP image.', 'warning')
  if (file.size > 5 * 1024 * 1024) return showToast('Photo not uploaded', 'Choose an image smaller than 5 MB.', 'warning')

  const button = document.getElementById('changeProfilePhotoBtn')
  const originalText = button?.textContent || '📷 Change Photo'
  if (button) {
    button.disabled = true
    button.textContent = 'Uploading...'
  }

  try {
    const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg'
    const path = `${settingsUser.id}/${crypto.randomUUID()}.${extension}`
    const { error: uploadError } = await supabase.storage.from('avatars').upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type,
    })
    let avatarUrl
    if (uploadError && /bucket not found|not found/i.test(uploadError.message || '')) {
      avatarUrl = await compressProfilePhoto(file)
    } else {
      if (uploadError) throw uploadError
      const { data: publicData } = supabase.storage.from('avatars').getPublicUrl(path)
      avatarUrl = publicData?.publicUrl
      if (!avatarUrl) throw new Error('Could not create a public photo URL.')
    }

    const { error: profileError } = await supabase
      .from('profiles')
      .update({ avatar_url: avatarUrl })
      .eq('id', settingsUser.id)
    if (profileError) throw profileError

    const name = document.getElementById('profileName')?.value || 'Admin'
    const initials = name.split(' ').map(word => word[0] || '').join('').slice(0, 2).toUpperCase()
    setProfileAvatar(avatarUrl, initials)
    showToast('Photo updated', 'Your profile photo was saved successfully.', 'success')
  } catch (error) {
    showToast('Photo not uploaded', error.message || 'Could not save your profile photo.', 'error')
  } finally {
    if (button) {
      button.disabled = false
      button.textContent = originalText
    }
  }
}

function compressProfilePhoto(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read the selected photo.'))
    reader.onload = () => {
      const image = new Image()
      image.onerror = () => reject(new Error('Could not process the selected photo.'))
      image.onload = () => {
        const size = 512
        const scale = Math.min(size / image.width, size / image.height, 1)
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(image.width * scale))
        canvas.height = Math.max(1, Math.round(image.height * scale))
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.78))
      }
      image.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}

// ── Dropdown Menu Management ───────────────────────────────────
function initDropdownMenu() {
  const toggle = document.getElementById('usersToggle')
  const submenu = document.getElementById('usersSubmenu')
  
  if (!toggle || !submenu) return

  toggle.addEventListener('click', (e) => {
    e.preventDefault()
    toggle.classList.toggle('active')
    submenu.classList.toggle('open')
  })

  // Close dropdown when clicking a submenu item
  document.querySelectorAll('.nav-submenu-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault()
      const section = item.dataset.section
      if (section === 'settings') { window.openModal('settingsModal'); return }
      if (section === 'profile')  { window.openModal('profileModal');  return }
      setActiveSection(section)
    })
  })
}

// ── Navigation ────────────────────────────────────────────────
function setActiveSection(section) {
  if (section === activeSection) return
  activeSection = section

  // Show/hide sections
  Object.entries(SECTIONS).forEach(([key, cfg]) => {
    const el = document.getElementById(cfg.id)
    if (el) el.classList.toggle('hidden', key !== section)
  })

  // Update topbar
  const cfg = SECTIONS[section]
  if (cfg) {
    setText('topbarTitle', cfg.title)
    setText('topbarSub',   cfg.sub)
  }

  // Update nav links (main links like Dashboard)
  document.querySelectorAll('.nav-link[data-section]').forEach(link => {
    link.classList.toggle('active', link.dataset.section === section)
  })

  // Update submenu items and dropdown state
  const usersToggle = document.getElementById('usersToggle')
  const usersSubmenu = document.getElementById('usersSubmenu')
  const submenuItems = document.querySelectorAll('.nav-submenu-item')
  
  // Check if the active section is a Users submenu item
  const isUsersSection = ['students', 'teachers', 'parents'].includes(section)
  
  if (usersToggle && usersSubmenu) {
    // Expand dropdown if navigating to a Users section
    if (isUsersSection) {
      usersToggle.classList.add('active')
      usersSubmenu.classList.add('open')
    } else {
      // Collapse dropdown when navigating away from Users sections
      usersToggle.classList.remove('active')
      usersSubmenu.classList.remove('open')
    }
  }

  // Update submenu item active state
  submenuItems.forEach(item => {
    item.classList.toggle('active', item.dataset.section === section)
  })

  // Dispatch event for any listeners
  window.dispatchEvent(new CustomEvent('sectionChange', { detail: { section } }))
}

// ── Modal Helpers (global) ────────────────────────────────────
window.openModal = function(id) {
  const el = document.getElementById(id)
  if (el) el.classList.remove('hidden')
  if (id === 'settingsModal' && settingsUser) refreshSecuritySettings()
}

window.closeModal = function(id) {
  const el = document.getElementById(id)
  if (el) el.classList.add('hidden')
}

// Close modal on backdrop click
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.add('hidden')
  }
})

// ── Expose module functions globally (for HTML onclick) ───────
window.logout               = logout

// Students
window.generateStudentId    = generateStudentId
window.submitAddStudent     = submitAddStudent
window.openEditStudentModal = openEditStudentModal
window.submitEditStudent    = submitEditStudent

// Teachers
window.generateTeacherId    = generateTeacherId
window.submitAddTeacher     = submitAddTeacher
window.openEditTeacherModal = openEditTeacherModal
window.submitEditTeacher    = submitEditTeacher

// Parents
window.generateParentId     = generateParentId
window.submitAddParent      = submitAddParent
window.openEditParentModal  = openEditParentModal
window.submitEditParent     = submitEditParent

// Attendance
window.submitManualEntry    = submitManualEntry
window.bulkMarkAttendance   = bulkMarkAttendance

// Grades
window.submitAddGrade       = submitAddGrade
window.openEditGradeModal   = openEditGradeModal

// ── Settings tabs ─────────────────────────────────────────────
function initSettingsTabs() {
  const tabs   = document.querySelectorAll('.settings-tabs .tab-btn')
  const panels = document.querySelectorAll('.settings-panel')
  if (!tabs.length) return
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const name = tab.dataset.tab
      tabs.forEach(t   => t.classList.toggle('active', t === tab))
      panels.forEach(p => p.classList.toggle('active', p.dataset.panel === name))
    })
  })
}

function passwordIsValid(password) {
  return password.length >= 8 && /[A-Z]/.test(password) && /\d/.test(password)
}

function setTwoFactorSetup(message, qrCode = '') {
  const setup = document.getElementById('settingsTwoFactorSetup')
  const messageEl = document.getElementById('settingsTwoFactorSetupMessage')
  const code = document.getElementById('settingsTwoFactorCode')
  if (!setup) return
  setup.classList.toggle('hidden', !message)
  if (messageEl) messageEl.innerHTML = message ? `${message}${qrCode ? `<br><img src="${qrCode}" alt="Two-factor setup QR code" style="max-width:180px;margin-top:8px">` : ''}` : ''
  if (code) code.hidden = !message
}

async function getTwoFactorFactors() {
  const { data, error } = await supabase.auth.mfa.listFactors()
  if (error) throw error
  return data || { all: [], verified: [], unverified: [] }
}

async function refreshSecuritySettings() {
  try {
    const factors = await getTwoFactorFactors()
    const enabled = (factors.verified || []).some(factor => factor.factor_type === 'totp')
    const select = document.getElementById('settingsTwoFactor')
    if (select) select.value = enabled ? 'enabled' : 'disabled'
    pendingTwoFactor = (factors.unverified || []).find(factor => factor.factor_type === 'totp') || null
    setTwoFactorSetup(pendingTwoFactor ? 'Enter the verification code from your authenticator app, then save again.' : '')
  } catch (error) {
    showToast('2FA unavailable', error.message || 'Could not load two-factor settings.', 'error')
  }
}

async function saveTwoFactorSetting() {
  const selected = document.getElementById('settingsTwoFactor')?.value
  if (!['enabled', 'disabled'].includes(selected)) {
    throw new Error('Select a valid two-factor authentication setting.')
  }

  const factors = await getTwoFactorFactors()
  const totpFactors = (factors.all || []).filter(factor => factor.factor_type === 'totp')
  if (selected === 'disabled') {
    for (const factor of totpFactors) {
      const { error } = await supabase.auth.mfa.unenroll({ factorId: factor.id })
      if (error) throw error
    }
    pendingTwoFactor = null
    setTwoFactorSetup('')
    return
  }

  const verified = (factors.verified || []).find(factor => factor.factor_type === 'totp')
  if (verified) return

  const factor = pendingTwoFactor || (await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'SchoolSys Admin' })).data
  if (!factor?.id) throw new Error('Could not start two-factor setup.')
  pendingTwoFactor = factor
  const code = document.getElementById('settingsTwoFactorCode')?.value.trim()
  if (!code) {
    setTwoFactorSetup('Scan the QR code with an authenticator app, enter the code below, and click Save Settings again.', factor.totp?.qr_code)
    throw new Error('Two-factor setup started. Enter the verification code and save again.')
  }

  const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: factor.id })
  if (challengeError) throw challengeError
  const { error: verifyError } = await supabase.auth.mfa.verify({ factorId: factor.id, challengeId: challenge.id, code })
  if (verifyError) throw verifyError
  pendingTwoFactor = null
  document.getElementById('settingsTwoFactorCode').value = ''
  setTwoFactorSetup('')
}

async function savePasswordSetting() {
  const current = document.getElementById('settingsCurrentPassword')?.value || ''
  const next = document.getElementById('settingsNewPassword')?.value || ''
  const confirmation = document.getElementById('settingsConfirmPassword')?.value || ''
  const hasPasswordChange = current || next || confirmation
  if (!hasPasswordChange) return
  if (!current || !next || !confirmation) throw new Error('Fill in all password fields to change your password.')
  if (!passwordIsValid(next)) throw new Error('New password must be at least 8 characters and include one uppercase letter and one number.')
  if (next !== confirmation) throw new Error('New password and confirmation do not match.')
  if (!settingsUser?.email) throw new Error('Could not identify the current admin account.')

  const { error: authError } = await supabase.auth.signInWithPassword({ email: settingsUser.email, password: current })
  if (authError) throw new Error('Current password is incorrect.')
  const { error: updateError } = await supabase.auth.updateUser({ password: next })
  if (updateError) throw updateError
  document.getElementById('settingsCurrentPassword').value = ''
  document.getElementById('settingsNewPassword').value = ''
  document.getElementById('settingsConfirmPassword').value = ''
}

async function saveSecuritySettings() {
  const button = document.getElementById('saveSettingsBtn')
  if (button) {
    button.disabled = true
    button.textContent = 'Saving...'
  }
  try {
    await saveTwoFactorSetting()
    await savePasswordSetting()
    await refreshSecuritySettings()
    showToast('Settings saved', 'Security settings were updated successfully.', 'success')
  } catch (error) {
    showToast('Settings not saved', error.message || 'Could not update security settings.', 'error')
    await refreshSecuritySettings()
  } finally {
    if (button) {
      button.disabled = false
      button.textContent = 'Save Settings'
    }
  }
}

function initSecuritySettings(user) {
  settingsUser = user
  const securityPanel = document.querySelector('[data-panel="security"]')
  if (!securityPanel) return
  if (document.getElementById('saveSettingsBtn')?.dataset.initialized) return
  document.getElementById('saveSettingsBtn').dataset.initialized = 'true'
  document.getElementById('saveSettingsBtn')?.addEventListener('click', saveSecuritySettings)
  refreshSecuritySettings()
}

// ── Sidebar search filter ─────────────────────────────────────
function initSidebarSearch() {
  const input = document.getElementById('sidebarSearch')
  if (!input) return
  input.addEventListener('input', () => {
    const q = input.value.toLowerCase()
    
    // Filter main nav links
    document.querySelectorAll('.nav-link[data-section]').forEach(link => {
      const text = link.textContent.toLowerCase()
      link.style.display = !q || text.includes(q) ? '' : 'none'
    })

    // Filter submenu items
    const usersDropdown = document.querySelector('.nav-dropdown')
    const submenuItems = document.querySelectorAll('.nav-submenu-item')
    let anySubmenuVisible = false

    submenuItems.forEach(item => {
      const text = item.textContent.toLowerCase()
      const isVisible = !q || text.includes(q)
      item.style.display = isVisible ? '' : 'none'
      if (isVisible) anySubmenuVisible = true
    })

    // Show/hide Users dropdown based on submenu visibility
    if (usersDropdown) {
      if (q && anySubmenuVisible) {
        usersDropdown.style.display = ''
        document.getElementById('usersToggle')?.classList.add('active')
        document.getElementById('usersSubmenu')?.classList.add('open')
      } else if (!q) {
        usersDropdown.style.display = ''
      } else {
        usersDropdown.style.display = 'none'
      }
    }
  })
}

// ── Global search ─────────────────────────────────────────────
function initGlobalSearch() {
  const input = document.getElementById('globalSearch')
  if (!input) return
  input.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return
    const q = input.value.trim()
    if (!q) return

    // Navigate to students and pre-fill search
    setActiveSection('students')
    const studentSearch = document.getElementById('studentSearch')
    if (studentSearch) {
      studentSearch.value = q
      studentSearch.dispatchEvent(new Event('input'))
    }
    input.value = ''
  })
}

// ── Real-time subscriptions ───────────────────────────────────
function initRealtime() {
  supabase.channel('schoolsys-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, payload => {
      console.log('↻ attendance changed', payload.eventType)
      if (activeSection === 'attendance') loadAttendance()
      if (activeSection === 'overview')   window.refreshChart?.()
      updateOverviewStats()
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, payload => {
      console.log('↻ profiles changed', payload.eventType)
      if (activeSection === 'students') loadStudents()
      if (activeSection === 'teachers') loadTeachers()
      if (activeSection === 'userManagement') loadUserManagement()
      updateOverviewStats()
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'grades' }, () => {
      if (activeSection === 'grades') loadGrades()
      updateOverviewStats()
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'parents' }, () => {
      if (activeSection === 'parents') loadParents()
      updateOverviewStats()
    })
    .subscribe(status => {
      if (status === 'SUBSCRIBED') console.log('✅ Real-time connected')
    })
}

// ── Lightweight stat refresh (for nav changes) ────────────────
async function updateOverviewStats() {
  if (activeSection !== 'overview') return
  const monthVal = document.getElementById('chartMonth')?.value
  loadDashboard(monthVal)
}

// ── Manual entry modal extra UI ───────────────────────────────
function ensureManualEntryModal() {
  if (document.getElementById('manualEntryModal')) return

  const modal = document.createElement('div')
  modal.id        = 'manualEntryModal'
  modal.className = 'modal-overlay hidden'
  modal.innerHTML = `
    <div class="modal-box">
      <div class="modal-head">
        <h2>Manual Attendance Entry</h2>
        <button class="modal-close" onclick="closeModal('manualEntryModal')">&times;</button>
      </div>
      <div class="modal-body">
        <form id="manualEntryForm" class="form-grid">
          <div class="form-group">
            <label class="form-label">Student <span class="req">*</span></label>
            <select id="manualStudentSelect" class="form-select" required>
              <option value="">Select student…</option>
            </select>
          </div>
          <div class="form-2col">
            <div class="form-group">
              <label class="form-label">Status <span class="req">*</span></label>
              <select id="manualStatus" class="form-select" required>
                <option value="">Select…</option>
                <option value="present">Present</option>
                <option value="absent">Absent</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Date <span class="req">*</span></label>
              <input id="manualDate" class="form-input" type="date" required />
            </div>
          </div>
        </form>
      </div>
      <div class="modal-foot">
        <button class="btn btn-secondary" onclick="closeModal('manualEntryModal')">Cancel</button>
        <button class="btn btn-primary" onclick="submitManualEntry()">Save Entry</button>
      </div>
    </div>`
  document.body.appendChild(modal)
}

// ── Edit Grade Modal extra fields ─────────────────────────────
function ensureEditGradeFields() {
  // The add-grade modal doubles as edit; we just need a hidden student select
  const form = document.getElementById('addGradeForm')
  if (!form || document.getElementById('editGradeStudent')) return
  const hidden = document.createElement('input')
  hidden.type = 'hidden'
  hidden.id   = 'editGradeStudent'
  form.appendChild(hidden)
}

// ── Boot ─────────────────────────────────────────────────────
async function boot() {
  const auth = await authGuard()
  if (!auth) return

  const { user } = auth

  // Load admin profile into sidebar/header
  await loadAdminProfile(user.id)

  // Init overview section
  initOverviewSection()
  
  // Init calendar (handles attendance display)
  initCalendar()

  // Load dashboard data
  loadDashboard()

  // Init all sections
  initStudentsSection()
  initTeachersSection()
  initParentsSection()
  initAttendanceSection()
  initScannerAttendance()
  document.addEventListener('scanner-attendance-recorded', loadAttendance)
  initGradesSection()
  initReportsSection()
  initUserManagementSection()
  initSettingsTabs()
  initSecuritySettings(user)
  document.getElementById('updateProfileBtn')?.addEventListener('click', saveAdminProfile)
  const photoInput = document.getElementById('profilePhotoInput')
  document.getElementById('changeProfilePhotoBtn')?.addEventListener('click', () => photoInput?.click())
  photoInput?.addEventListener('change', event => {
    uploadProfilePhoto(event.target.files?.[0])
    event.target.value = ''
  })
  initDropdownMenu()
  initSidebarSearch()
  initGlobalSearch()

  // Inject dynamically needed modals
  ensureManualEntryModal()
  ensureEditGradeFields()

  // Wire nav links
  document.querySelectorAll('.nav-link[data-section]').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault()
      const section = link.dataset.section
      if (section === 'settings') { window.openModal('settingsModal'); return }
      if (section === 'profile')  { window.openModal('profileModal');  return }
      setActiveSection(section)
    })
  })

  // Start with overview section visible
  setActiveSection('overview')

  // Real-time subscriptions
  initRealtime()

  // Keyboard shortcut: Escape closes open modals
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return
    document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m => {
      m.classList.add('hidden')
    })
  })

  // Show welcome toast
  const name = auth.profile?.name?.split(' ')[0] || 'Admin'
  showToast('Welcome back!', `Logged in as ${name}`, 'success', 3000)

  console.log('✅ SchoolSys Admin booted successfully')
}

// ── Helper ────────────────────────────────────────────────────
function setText(id, val) {
  const el = document.getElementById(id)
  if (el) el.textContent = val ?? '—'
}

// ── Start ─────────────────────────────────────────────────────
boot()
