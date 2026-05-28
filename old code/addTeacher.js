import { supabase } from './supabaseClient.js'

/**
 * Generate a unique teacher ID
 * Format: TCH-XXXXXXXX
 */
export function generateTeacherId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let randomPart = '';
  for (let i = 0; i < 8; i++) {
    randomPart += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  const teacherId = `TCH-${randomPart}`;
  const input = document.getElementById('teacherId');
  if (input) {
    input.value = teacherId;
  }
}

/**
 * Submit new teacher form
 */
export async function submitAddTeacher() {
  const name = document.getElementById('teacherName').value.trim()
  const email = document.getElementById('teacherEmail').value.trim()
  const password = document.getElementById('teacherPassword').value.trim()
  const teacher_id = document.getElementById('teacherId').value.trim() // Captured here
  const contact = document.getElementById('teacherContact').value.trim()

  if (!name || !email || !password || !teacher_id) {
    alert('❌ Please fill in Name, Email, Password, and Teacher ID')
    return
  }

  try {
    // Step 1: Auth
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name: name } }
    })

    if (authError) throw authError

    // Step 2: Profile
    const { error: profileError } = await supabase
      .from('profiles')
      .insert([{
        id: authData.user.id,
        name,
        email,
        teacher_id, // Saving the generated ID
        contact: contact || null,
        role: 'TEACHER'
      }])

    if (profileError) {
        console.error("Profile created failed, but Auth succeeded.");
        throw profileError;
    }

    // CRITICAL: Ensure this part doesn't crash
    console.log("✅ Success!");
    alert("Teacher created successfully.");
    window.location.reload(); 

    } catch (err) {
    // If you see the 500 error here, check if the record actually exists in Supabase
    console.error("The server complained, but check your dashboard!");
    }
}

/**
 * Initialize "Add Teacher" button handler
 */
export function initAddTeacherButton() {
    const addButton = document.querySelector('#teachersSection .manage-actions .btn-primary')
    if (addButton) {
        addButton.addEventListener('click', () => {
            console.log('🆕 Opening Add Teacher modal')
            if (window.openModal) window.openModal('addTeacherModal')
        })
    }
}
// In addTeacher.js
const teacherForm = document.getElementById('addTeacherForm');
if (teacherForm) {
    teacherForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await submitAddTeacher(); // This calls the function you revised earlier
    });
}