import { supabase } from '../services/supabaseClient.js'

export async function loadSchoolBranding() {
  const { data, error } = await supabase.rpc('get_public_school_branding')
  if (error) {
    console.warn('School branding could not be loaded:', error.message)
    return
  }

  const settings = Object.fromEntries((data || []).map(row => [row.key, row.value]))
  const name = String(settings.school_name ?? '').trim()
  const logoUrl = String(settings.school_logo_url ?? '').trim()
  const announcement = String(settings.maintenance_announcement ?? '').trim()

  const displayName = name || 'EASPO'
  document.querySelectorAll('[data-school-name]').forEach(element => {
    element.textContent = displayName
    element.classList.remove('hidden')
  })
  const titleSuffix = document.body.dataset.brandTitle
  if (titleSuffix) document.title = `${displayName} — ${titleSuffix}`

  const displayLogoUrl = /^https:\/\//i.test(logoUrl) ? logoUrl : 'logo.png'
  document.querySelectorAll('[data-school-logo], .sidebar-logo, .scanner-brand-logo, .login-brand-icon img')
    .forEach(image => {
      image.onerror = () => {
        console.error('Configured school logo could not be loaded.')
        image.onerror = null
        if (image instanceof HTMLLinkElement) image.href = 'logo.png'
        else image.src = 'logo.png'
      }
      if (image instanceof HTMLLinkElement) {
        image.href = displayLogoUrl
        const path = new URL(displayLogoUrl, window.location.href).pathname.toLowerCase()
        image.type = path.endsWith('.webp') ? 'image/webp' : path.endsWith('.jpg') || path.endsWith('.jpeg') ? 'image/jpeg' : 'image/png'
      } else {
        image.src = displayLogoUrl
        image.alt = name ? `${name} logo` : 'School logo'
      }
    })

  const notice = document.getElementById('systemMaintenanceNotice')
  if (notice) {
    notice.textContent = announcement
    notice.classList.toggle('hidden', !announcement)
  }
}
