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

import {
  initGradesSection,
  loadGrades,
  submitAddGrade,
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
                <option value="late">Late</option>
                <option value="excused">Excused</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Date <span class="req">*</span></label>
              <input id="manualDate" class="form-input" type="date" required />
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Note (optional)</label>
            <input id="manualNote" class="form-input" type="text" placeholder="e.g. Medical excuse, field trip…" />
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">
            <button type="button" class="btn btn-secondary btn-sm" onclick="bulkMarkAttendance('present')">✅ Mark All Present</button>
            <button type="button" class="btn btn-secondary btn-sm" onclick="bulkMarkAttendance('absent')">❌ Mark All Absent</button>
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
  initGradesSection()
  initReportsSection()
  initUserManagementSection()
  initSettingsTabs()
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
