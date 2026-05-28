import { supabase } from './supabaseClient.js'

/**
 * Generate a unique student ID
 * Format: STD-XXXXXXXX (8 random alphanumeric characters)
 */
export function generateStudentId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let id = ''
  for (let i = 0; i < 8; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  const studentId = `STD-${id}`
  document.getElementById('studentId').value = studentId
  console.log('✅ Generated Student ID:', studentId)
}

/**
 * Submit new student form to Supabase
 * Creates both an Auth account and a profile record
 */
export async function submitAddStudent() {
  console.log('📝 Submitting new student...')
  
  const name = document.getElementById('studentName').value.trim()
  const email = document.getElementById('studentEmail').value.trim()
  const password = document.getElementById('studentPassword').value.trim()
  const student_id = document.getElementById('studentId').value.trim()
  const contact = document.getElementById('studentContact').value.trim()
  const address = document.getElementById('studentAddress').value.trim()
  const guardian_name = document.getElementById('guardianName').value.trim()

  // Validate required fields
  if (!name || !email || !password || !student_id) {
    alert('❌ Please fill in all required fields (Name, Email, Password, Student ID)')
    return
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(email)) {
    alert('❌ Please enter a valid email address')
    return
  }

  // Validate password length
  if (password.length < 6) {
    alert('❌ Password must be at least 6 characters long')
    return
  }

  try {
    // Step 1: Sign up the user to create an Auth account
    console.log('🔐 Creating student account...')
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          name: name
        }
      }
    })

    if (authError) {
      console.error('❌ Auth Error:', authError)
      console.error('Error details:', authError.message, authError.status)
      alert(`❌ Failed to create account: ${authError.message}\n\nTry a different email or check Supabase Auth settings.`)
      return
    }

    const userId = authData.user.id
    console.log('✅ Auth account created:', userId)

    // Step 2: Create the student profile record linked to the auth user
    console.log('📝 Creating student profile...')
    const { data, error } = await supabase
      .from('profiles')
      .insert([
        {
          id: userId,  // Link to the auth user ID
          name,
          email,
          student_id,
          contact: contact || null,
          address: address || null,
          guardian_name: guardian_name || null,
          role: 'STUDENT'
        }
      ])
      .select()

    if (error) {
      console.error('❌ Profile Error:', error.message)
      alert(`❌ Error creating profile: ${error.message}`)
      return
    }

    console.log('✅ Student created successfully:', data)
    alert(`✅ Student "${name}" created successfully!\n\n📧 Email: ${email}\n🆔 Student ID: ${student_id}\n\n✉️ Confirmation email sent to ${email}`)

    // Reset form
    document.getElementById('addStudentForm').reset()
    document.getElementById('studentId').value = ''

    // Close modal
    window.closeModal('addStudentModal')

    // Refresh student list
    const { getManagementData } = await import('./students.js')
    getManagementData()

  } catch (err) {
    console.error('❌ Unexpected error:', err)
    alert('❌ An unexpected error occurred. Check console for details.')
  }
}

/**
 * Initialize "Add Student" button click handler
 */
export function initAddStudentButton() {
  const addButton = document.querySelector('#studentsSection .manage-actions .btn-primary')
  if (addButton) {
    addButton.addEventListener('click', () => {
      console.log('🆕 Opening Add Student modal')
      window.openModal('addStudentModal')
      generateStudentId() // Auto-generate ID when modal opens
    })
  }
}
