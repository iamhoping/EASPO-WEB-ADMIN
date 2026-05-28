import { supabase } from './supabaseClient.js'

let currentEditingStudentId = null

/**
 * Open the edit modal and populate it with student data
 */
export async function openEditModal(studentId, studentName) {
  console.log('📝 Opening edit modal for student:', studentName)
  currentEditingStudentId = studentId

  try {
    // Fetch the full student data
    const { data: student, error } = await supabase
      .from('profiles')
      .select('id, name, email, contact, address, student_id, guardian_name')
      .eq('id', studentId)
      .single()

    if (error) {
      console.error('❌ Error fetching student:', error.message)
      alert('Failed to load student data')
      return
    }

    // Populate the form with current data
    document.getElementById('editStudentId').value = student.id
    document.getElementById('editStudentName').value = student.name || ''
    document.getElementById('editStudentEmail').value = student.email || ''
    document.getElementById('editStudentIdField').value = student.student_id || ''
    document.getElementById('editStudentContact').value = student.contact || ''
    document.getElementById('editStudentAddress').value = student.address || ''
    document.getElementById('editGuardianName').value = student.guardian_name || ''

    // Open the modal
    window.openModal('editStudentModal')
  } catch (err) {
    console.error('❌ Unexpected error:', err.message)
    alert('An error occurred while loading student data')
  }
}

/**
 * Submit edited student data to Supabase
 */
export async function submitEditStudent() {
  console.log('💾 Saving student changes...')

  const studentId = document.getElementById('editStudentId').value
  const name = document.getElementById('editStudentName').value.trim()
  const email = document.getElementById('editStudentEmail').value.trim()
  const contact = document.getElementById('editStudentContact').value.trim()
  const address = document.getElementById('editStudentAddress').value.trim()
  const guardian_name = document.getElementById('editGuardianName').value.trim()

  // Validate required fields
  if (!name || !email) {
    alert('❌ Name and Email are required')
    return
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(email)) {
    alert('❌ Please enter a valid email address')
    return
  }

  try {
    // Update the profile record
    const { error } = await supabase
      .from('profiles')
      .update({
        name,
        email,
        contact: contact || null,
        address: address || null,
        guardian_name: guardian_name || null
      })
      .eq('id', studentId)

    if (error) {
      console.error('❌ Update Error:', error.message)
      alert(`❌ Failed to update student: ${error.message}`)
      return
    }

    console.log('✅ Student updated successfully')
    alert(`✅ Student "${name}" updated successfully!`)

    // Close modal
    window.closeModal('editStudentModal')

    // Refresh the student list
    const { getManagementData } = await import('./students.js')
    getManagementData()
  } catch (err) {
    console.error('❌ Unexpected error:', err.message)
    alert('An error occurred while saving changes')
  }
}
