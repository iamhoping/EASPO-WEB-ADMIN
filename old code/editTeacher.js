import { supabase } from './supabaseClient.js'

let currentEditingTeacherId = null

export async function openEditTeacherModal(teacherId, teacherName) {
  console.log('📝 Opening edit modal for teacher:', teacherName)
  currentEditingTeacherId = teacherId

  try {
    const { data: teacher, error } = await supabase
      .from('profiles')
      .select('id, name, email, contact, address, department, status')
      .eq('id', teacherId)
      .single()

    if (error) {
      console.error('❌ Error fetching teacher:', error.message)
      alert('Failed to load teacher data')
      return
    }

    // 1. OPEN MODAL FIRST (Ensures elements are rendered in the DOM)
    if (window.openModal) {
      window.openModal('editTeacherModal')
    }

    // 2. USE A HELPER OR CHECK FOR NULL
    const elements = {
      'editTeacherId': teacher.id,
      'editTeacherName': teacher.name || '',
      'editTeacherEmail': teacher.email || '',
      'editTeacherContact': teacher.contact || '',
      'editTeacherStatus': teacher.status || '',
      'editTeacherDepartment': teacher.department || ''
    };

    // Loop through elements and set values safely
    for (const [id, value] of Object.entries(elements)) {
      const el = document.getElementById(id);
      if (el) {
        el.value = value;
      } else {
        console.warn(`⚠️ Warning: Element with ID "${id}" not found in the HTML.`);
      }
    }

  } catch (err) {
    console.error('❌ Unexpected error:', err.message)
    alert('An error occurred while loading teacher data')
  }
}

export async function submitEditTeacher() {
  console.log('💾 Saving teacher changes...')

  const teacherId = document.getElementById('editTeacherId').value
  const name = document.getElementById('editTeacherName').value.trim()
  const email = document.getElementById('editTeacherEmail').value.trim()
  const contact = document.getElementById('editTeacherContact').value.trim()
  const status = document.getElementById('editTeacherStatus').value.trim()
  const department = document.getElementById('editTeacherDepartment').value.trim()

  if (!name || !email) {
    alert('❌ Name and Email are required')
    return
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(email)) {
    alert('❌ Please enter a valid email address')
    return
  }

  try {
    const { error } = await supabase
      .from('profiles') // change if needed
      .update({
        name,
        email,
        contact: contact || null,
        department: department || null,
        status: status || null
      })
      .eq('id', teacherId)

    if (error) {
      console.error('❌ Update Error:', error.message)
      alert(`❌ Failed to update teacher: ${error.message}`)
      return
    }

    console.log('✅ Teacher updated successfully')
    alert(`✅ Teacher "${name}" updated successfully!`)

    window.closeModal('editTeacherModal')

    const { getManagementData  } = await import('./teachers.js')
    getManagementData ()
  } catch (err) {
    console.error('❌ Unexpected error:', err.message)
    alert('An error occurred while saving changes')
  }
}