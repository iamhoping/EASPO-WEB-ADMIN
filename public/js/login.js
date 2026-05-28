// /js/login.js
import { login } from './services/auth.js'
import { supabase } from './services/supabaseClient.js'

window.handleLogin = async function (event) {
  event.preventDefault()
  const email    = document.getElementById('email').value.trim()
  const password = document.getElementById('password').value
  const statusEl = document.getElementById('loginStatus')
  const btn      = document.getElementById('loginBtn')

  setStatus('', '')
  btn.disabled = true
  btn.textContent = 'Signing in…'

  const { data, error } = await login(email, password)

  if (error) {
    setStatus(error.message, 'error')
    btn.disabled = false
    btn.textContent = 'Sign In'
    return
  }

  setStatus('Login successful! Redirecting…', 'success')
  await verifyAndRedirect(data.user.id)
}

async function verifyAndRedirect(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('role, name')
    .eq('id', userId)
    .single()

  if (error || !data) {
    setStatus('Could not load profile. Contact support.', 'error')
    await supabase.auth.signOut()
    return
  }

  if (data.role === 'WEB_ADMIN') {
    window.location.href = 'admin.html'
  } else {
    setStatus('Access denied. This portal is for administrators only.', 'error')
    await supabase.auth.signOut()
    document.getElementById('loginBtn').disabled = false
    document.getElementById('loginBtn').textContent = 'Sign In'
  }
}

function setStatus(msg, type) {
  const el = document.getElementById('loginStatus')
  el.textContent = msg
  el.className = type
}