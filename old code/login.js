import { login } from './auth.js'
import { supabase } from './supabaseClient.js'

/**
 * 🔐 Handle login form submission
 */
window.login = async function (event) {
  event.preventDefault()
  const email = document.getElementById("email").value
  const password = document.getElementById("password").value

  const { data, error } = await login(email, password)

  if (error) {
    document.getElementById("status").innerText = error.message
    return
  }

  document.getElementById("status").innerText = "Login success!"
  await getUserProfile(data.user.id)
}

/**
👤 Verify WEB_ADMIN role after login
 **/
async function getUserProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()

  if (error) {
    document.getElementById("status").innerText = error.message
    return
  }

  if (data.role === "WEB_ADMIN") {
    window.location.href = "admin.html"
  } else {
    document.getElementById("status").innerText = "Access denied: Only WEB_ADMIN can log in."
    await supabase.auth.signOut()
  }
}