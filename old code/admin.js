import { loadDashboard } from './dashboard.js'
import { logout } from './auth.js'
import { supabase } from './supabaseClient.js'
import { initOverviewSection } from './overview.js'
import { initStudentsSection } from './students.js'
import { initTeachersSection } from './teachers.js'
import { initAttendanceSection } from './attendance.js'
import { initSettingsSection } from './settings.js'
import { initProfileSection } from './profile.js'
import { generateStudentId, submitAddStudent } from './addStudent.js'
import { openEditModal, submitEditStudent } from './editStudent.js'
import { openEditTeacherModal, submitEditTeacher } from './editTeacher.js'  
// Removed the duplicate import line here
import { generateTeacherId, submitAddTeacher } from './addTeacher.js' // Add this!

window.logout = logout
window.generateStudentId = generateStudentId
window.generateTeacherId = generateTeacherId // Make this global
window.submitAddStudent = submitAddStudent
window.submitAddTeacher = submitAddTeacher // Make this global
window.openEditModal = openEditModal
window.submitEditStudent = submitEditStudent
window.openEditTeacherModal = openEditTeacherModal
window.submitEditTeacher = submitEditTeacher

initOverviewSection()
initStudentsSection()
initTeachersSection()
initAttendanceSection()
initSettingsSection()
initProfileSection()

function setActiveSection(section) {
  // Dispatch event to notify sections of change
  window.dispatchEvent(new CustomEvent('sectionChange', { detail: { section } }))

  document.getElementById('overviewSection').classList.toggle('hidden', section !== 'overview')
  document.getElementById('studentsSection').classList.toggle('hidden', section !== 'students')
  document.getElementById('teachersSection').classList.toggle('hidden', section !== 'teachers')
  document.getElementById('attendanceSection').classList.toggle('hidden', section !== 'attendance')

  document.querySelectorAll('.nav-link').forEach(link => {
    const isPage = ['overview', 'students', 'teachers', 'attendance'].includes(link.dataset.section)
    link.classList.toggle('active', link.dataset.section === section && isPage)
  })

  const title = section === 'students'
    ? 'Manage Students'
    : section === 'teachers'
      ? 'Manage Teachers'
      : section === 'attendance'
        ? 'Attendance Logs'
        : 'Admin Dashboard Overview'

  const subtitle = section === 'students'
    ? 'Create, filter, and act on student records with one click.'
    : section === 'teachers'
      ? 'Search teachers by subject, department, or availability.'
      : section === 'attendance'
        ? 'Real-time attendance tracking with manual override options.'
        : 'Summary of students, teachers and attendance performance.'

  document.querySelector('.topbar h1').innerText = title
  document.querySelector('.overview-intro').innerText = subtitle

  const searchInput = document.querySelector('.global-search input')
  if (searchInput) {
    searchInput.placeholder = section === 'teachers'
      ? 'Search by name, ID, or subject...'
      : 'Search everything...'
  }
}

document.querySelectorAll('.nav-link[data-section]').forEach(link => {
  link.addEventListener('click', event => {
    event.preventDefault()
    const section = event.currentTarget.dataset.section
    if (section === 'settings') return openModal('settingsModal')
    if (section === 'profile') return openModal('profileModal')
    setActiveSection(section)
  })
})

window.openModal = modalId => {
  const modal = document.getElementById(modalId)
  if (modal) modal.classList.remove('hidden') // Or .style.display = 'block'
}

window.closeModal = modalId => {
  const modal = document.getElementById(modalId)
  if (modal) modal.classList.add('hidden') // Or .style.display = 'none'
}

const channel = supabase.channel('dashboard')
channel.on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, () => window.refreshChart?.())
channel.on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => window.refreshChart?.())
channel.subscribe()

window.refreshChart?.()
