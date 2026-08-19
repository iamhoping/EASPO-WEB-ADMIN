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

window.showForgotPassword = function () {
  document.getElementById('loginForm').classList.add('hidden')
  document.getElementById('forgotPasswordBtn').classList.add('hidden')
  document.getElementById('forgotPasswordForm').classList.remove('hidden')
  setStatus('', '')
  document.getElementById('resetEmail').value = document.getElementById('email').value.trim()
  document.getElementById('resetEmail').focus()
}

window.showLoginForm = function () {
  document.getElementById('forgotPasswordForm').classList.add('hidden')
  document.getElementById('updatePasswordForm').classList.add('hidden')
  document.getElementById('loginForm').classList.remove('hidden')
  document.getElementById('forgotPasswordBtn').classList.remove('hidden')
  setStatus('', '')
}

window.handleForgotPassword = async function (event) {
  event.preventDefault()
  const email = document.getElementById('resetEmail').value.trim()
  const btn = document.getElementById('resetBtn')

  setStatus('', '')
  btn.disabled = true
  btn.textContent = 'Sending…'

  const redirectUrl = getWebResetRedirectUrl()
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: redirectUrl
  })

  if (error) {
    setStatus(error.message, 'error')
    btn.disabled = false
    btn.textContent = 'Send Reset Link'
    return
  }

  setStatus('Reset link sent. Check your email.', 'success')
  btn.disabled = false
  btn.textContent = 'Send Reset Link'
}

window.handleUpdatePassword = async function (event) {
  event.preventDefault()
  const password = document.getElementById('newPassword').value
  const confirmation = document.getElementById('confirmPassword').value
  const btn = document.getElementById('updatePasswordBtn')

  if (password !== confirmation) {
    setStatus('Passwords do not match.', 'error')
    return
  }

  btn.disabled = true
  btn.textContent = 'Updating…'
  const { error } = await supabase.auth.updateUser({ password })

  if (error) {
    setStatus(error.message, 'error')
    btn.disabled = false
    btn.textContent = 'Update Password'
    return
  }

  setStatus('Password updated. You can now sign in.', 'success')
  document.getElementById('updatePasswordForm').classList.add('hidden')
  document.getElementById('loginForm').classList.remove('hidden')
  document.getElementById('forgotPasswordBtn').classList.remove('hidden')
  btn.disabled = false
  btn.textContent = 'Update Password'
}

function showRecoveryForm() {
  document.getElementById('loginForm').classList.add('hidden')
  document.getElementById('forgotPasswordBtn').classList.add('hidden')
  document.getElementById('forgotPasswordForm').classList.add('hidden')
  document.getElementById('updatePasswordForm').classList.remove('hidden')
  setStatus('Choose a new password.', 'success')
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

function getWebResetRedirectUrl() {
  return new URL('index.html', window.location.href).href
}

supabase.auth.onAuthStateChange((event) => {
  if (event === 'PASSWORD_RECOVERY') showRecoveryForm()
})

function initializeRecoveryState() {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const query = new URLSearchParams(window.location.search)
  const recoveryError = hash.get('error_description') || query.get('error_description')

  if (recoveryError) {
    setStatus(decodeURIComponent(recoveryError.replace(/\+/g, ' ')), 'error')
    return
  }

  if (hash.get('type') === 'recovery' || hash.has('access_token') || query.get('type') === 'recovery') {
    showRecoveryForm()
  }
}

initializeRecoveryState()