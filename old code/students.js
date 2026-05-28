import { supabase } from './supabaseClient.js'
import { generateStudentId, submitAddStudent } from './addStudent.js'

let allStudents = []

/**
 * Fetch all info for the student list
 */
export async function getManagementData() {
  console.log('🔄 Fetching students from profiles table...')
  
  // First, let's check what data exists in the entire profiles table
  const { data: allProfiles, error: allError } = await supabase
    .from('profiles')
    .select('*')
  
  if (allError) {
    console.error('❌ Error checking all profiles:', allError.message)
  } else {
    console.log('📋 ALL profiles in database:', allProfiles)
    if (allProfiles && allProfiles.length > 0) {
      console.log('   Sample role values:', allProfiles.map(p => `"${p.role}"`).join(', '))
    }
  }
  
  const { data: studentList, error } = await supabase
    .from('profiles')
    .select('id, name, email, contact, address, student_id, guardian_name')
    .eq('role', 'STUDENT')
    .order('name', { ascending: true })

  if (error) {
    console.error('❌ Database Error:', error.message)
    console.error('   Error Code:', error.code)
    console.error('   Error Details:', error)
    console.warn('⚠️ Possible causes:')
    console.warn('   1. Row Level Security (RLS) is blocking access')
    console.warn('   2. Role value should be exactly "STUDENT" (case-sensitive)')
    console.warn('   3. Incorrect Supabase URL or API key')
    console.warn('   4. Profiles table is empty')
    return
  }

  console.log('✅ Data Retrieved:', studentList)
  console.log(`   Total Students: ${studentList?.length || 0}`)
  allStudents = studentList || []
  renderStudentsTable(allStudents)
}


/**
 * Render students in the table
 */
function renderStudentsTable(students) {
  const tbody = document.querySelector('#studentsSection tbody')
  if (!tbody) return

  if (students.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 20px;">No students found</td></tr>'
    const footerSpan = document.querySelector('#studentsSection .table-footer span')
    if (footerSpan) footerSpan.textContent = `Showing 0 of 0 students`
    return
  }

  tbody.innerHTML = students.map((student) => `
    <tr>
      <td class="checkbox-cell"><input type="checkbox" /></td>
      <td>${student.name || 'N/A'}</td>
      <td>${student.email || 'N/A'}</td>
      <td>${student.student_id || 'N/A'}</td>
      <td>${student.contact || '-'}</td>
      <td>${student.address || '-'}</td>
      <td>${student.guardian_name || '-'}</td>
      <td><button class="btn-action" onclick="openEditModal('${student.id}', '${(student.name || '').replace(/'/g, "\\'")}')">✏️ Edit</button></td>
    </tr>
  `).join('')

  const footerSpan = document.querySelector('#studentsSection .table-footer span')
  if (footerSpan) footerSpan.textContent = `Showing 1-${Math.min(10, students.length)} of ${students.length} students`
}

/**
 * Filter students by search query
 */
function filterStudents(query) {
  if (!query) {
    renderStudentsTable(allStudents)
    return
  }

  const filtered = allStudents.filter(student =>
    student.name.toLowerCase().includes(query.toLowerCase()) ||
    student.email.toLowerCase().includes(query.toLowerCase())
  )
  renderStudentsTable(filtered)
}

export function initStudentsSection() {
  console.log('📌 Initializing Students Section')
  const section = document.getElementById('studentsSection')
  if (!section) {
    console.warn('⚠️ studentsSection not found')
    return
  }

  // Load students when section initializes
  getManagementData()

  const addButton = section.querySelector('.manage-actions .btn-primary')
  const exportButton = section.querySelector('.manage-actions .btn-secondary')
  const filterButton = section.querySelectorAll('.manage-actions .btn-secondary')[1]
  const searchInput = section.querySelector('.section-search input')

  addButton?.addEventListener('click', () => {
    console.log('🆕 Opening Add Student modal')
    window.openModal('addStudentModal')
    generateStudentId()
  })

  exportButton?.addEventListener('click', () => {
    console.log('Manage Students -> Export')
  })

  filterButton?.addEventListener('click', () => {
    console.log('Manage Students -> Filters')
  })

  searchInput?.addEventListener('input', event => {
    filterStudents(event.target.value)
  })

  // Reload students when section becomes visible
  window.addEventListener('sectionChange', () => {
    getManagementData()
  })
}
