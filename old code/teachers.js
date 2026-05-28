import { supabase } from './supabaseClient.js'
import { submitAddTeacher } from './addTeacher.js' // Ensure this matches your filename

const DEPARTMENT_SUBJECTS = {
  Science: ['Biology', 'Chemistry', 'Physics'],
  Mathematics: ['Algebra', 'Calculus', 'Geometry'],
  'Arts & Humanities': ['English', 'History', 'Literature'],
  'Physical Education': ['Sports', 'Fitness', 'Health']
}

let allTeachers = []

/**
 * Fetch all info for the teacher list
 */
export async function getManagementData() {
  console.log('🔄 Fetching teachers from profiles table...')
  
  const { data: teacherList, error } = await supabase
    .from('profiles')
    .select('id, name, email, contact, teacher_id, department, status')
    .eq('role', 'TEACHER')
    .order('name', { ascending: true })

  if (error) {
    console.error('❌ Database Error:', error.message)
    return
  }

  console.log('✅ Data Retrieved:', teacherList)
  allTeachers = teacherList || []
  renderTeachersTable(allTeachers)
}

/**
 * Render teachers in the table
 */
function renderTeachersTable(teachers) {
  const tbody = document.querySelector('#teachersSection tbody')
  if (!tbody) return

  const footerSpan = document.querySelector('#teachersSection .table-footer span')

  if (teachers.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; padding: 20px;">
          No teachers found
        </td>
      </tr>
    `
    if (footerSpan) footerSpan.textContent = `Showing 0 of 0 teachers`
    return
  }

  tbody.innerHTML = teachers.map((teacher) => {
    const initials = (teacher.name || 'T')
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)

    const dept = teacher.department || 'N/A'
    const subjects = DEPARTMENT_SUBJECTS[dept] || []
    return `
      <tr data-id="${teacher.id}">
        <td class="checkbox-cell"><input type="checkbox" /></td>

        <td>
          <div class="teacher-row">
            <div class="teacher-avatar">${initials}</div>
            <div class="teacher-meta">
              <div class="teacher-name">${teacher.name || 'N/A'}</div>
              <div class="teacher-email">${teacher.email || 'N/A'}</div>
            </div>
          </div>
        </td>

        <td>${teacher.email || 'N/A'}</td>
        <td>${teacher.teacher_id || 'N/A'}</td>

        <td class="teacher-department">${dept}</td>

        <td>
            <div class="subject-list">
              ${
                subjects.length > 0
                  ? subjects.slice(0, 2).map(s => `<span class="subject-pill">${s}</span>`).join('')
                  : `<span class="subject-pill">No subjects</span>`
              }
            </div>
        </td>

        <td>
          <span class="status-pill">${teacher.status || 'Active'}</span>
        </td>

        <td class="actions-cell">
          <button title="Edit"
            onclick="openEditTeacherModal('${teacher.id}', '${teacher.name || ''}')">
            ✏️
          </button>

          <button title="Assign">🧑‍🏫</button>
          <button class="actions-menu" title="More">⋮</button>
        </td>
      </tr>
    `
  }).join('')

  if (footerSpan) {
    footerSpan.textContent = `Showing 1-${Math.min(10, teachers.length)} of ${teachers.length} teachers`
  }
}

/**
 * Filter teachers by search query
 */
function filterTeachers(query) {
  if (!query) {
    renderTeachersTable(allTeachers)
    return
  }

  const filtered = allTeachers.filter(teacher =>
    (teacher.name || '').toLowerCase().includes(query.toLowerCase()) ||
    (teacher.email || '').toLowerCase().includes(query.toLowerCase())
  )
  renderTeachersTable(filtered)
}

/**
 * Initialize Teachers Section
 */

export function initTeachersSection() {
  console.log('📌 Initializing Teachers Section')
  const section = document.getElementById('teachersSection')
  
  if (!section) {
    console.warn('⚠️ teachersSection not found')
    return
  }

  // Load teachers initially
  getManagementData()

  // Grab UI Elements
  const addButton = section.querySelector('.manage-actions .btn-primary')
  const searchInput = section.querySelector('.section-search input')
  const teacherForm = document.getElementById('addTeacherForm')

  // Open Modal logic
  addButton?.addEventListener('click', () => {
    console.log('🆕 Opening Add Teacher modal')
    window.openModal('addTeacherModal')
    // Automatically generate ID when opening
    generateTeacherId() 
  })

  // Handle Form Submission
  if (teacherForm) {
      teacherForm.onsubmit = async (e) => {
          e.preventDefault()
          await submitAddTeacher()
      }
  }

  // Search logic
  searchInput?.addEventListener('input', event => {
    filterTeachers(event.target.value)
  })

  // Reload when section changes
  window.addEventListener('sectionChange', () => {
    getManagementData()
  })
}
