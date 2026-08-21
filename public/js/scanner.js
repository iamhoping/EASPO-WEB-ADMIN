import { supabase } from './services/supabaseClient.js'
import { logout } from './services/auth.js'
import { initScannerAttendance } from './modules/scanner-attendance.js'

async function bootScanner() {
  const { data: { session } = {}, error: sessionError } = await supabase.auth.getSession()
  const user = session?.user
  if (sessionError || !user) {
    window.location.href = 'index.html'
    return
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, name')
    .eq('id', user.id)
    .single()

  if (profileError || profile?.role !== 'SCANNER') {
    await supabase.auth.signOut()
    window.location.href = 'index.html'
    return
  }

  document.getElementById('scannerAccountName').textContent = profile.name || user.email || 'Scanner'
  document.getElementById('scannerAccountEmail').textContent = user.email || ''
  document.getElementById('scannerLogout').addEventListener('click', logout)
  initScannerAttendance()
}

supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT' || (event === 'TOKEN_REFRESHED' && !session)) {
    window.location.href = 'index.html'
  }
})

bootScanner()
