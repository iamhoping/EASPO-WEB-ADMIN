import { supabase } from './services/supabaseClient.js'
import { logout } from './services/auth.js'
import { initScannerAttendance } from './modules/scanner-attendance.js'
import { loadSchoolBranding } from './modules/school-branding.js'

loadSchoolBranding()

async function bootScanner() {
  const { data: { session } = {}, error: sessionError } = await supabase.auth.getSession()
  const user = session?.user
  if (sessionError || !user) {
    window.location.href = 'index.html'
    return
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, name, status')
    .eq('id', user.id)
    .single()

  if (profileError || profile?.role !== 'SCANNER' ||
      String(profile?.status || '').toLowerCase() === 'inactive') {
    await supabase.auth.signOut()
    window.location.href = 'index.html'
    return
  }

  document.getElementById('scannerLogout').addEventListener('click', logout)
  initScannerAttendance()
}

supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT' || (event === 'TOKEN_REFRESHED' && !session)) {
    window.location.href = 'index.html'
  }
})

bootScanner()
