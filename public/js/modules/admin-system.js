import { supabase } from '../services/supabaseClient.js'
import { showToast } from '../ui/toast.js'
import { renderPagination } from '../ui/pagination.js'
import { loadSchoolBranding } from './school-branding.js'

const PAGE_SIZE = 20
const escapeHtml = value => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')

const setText = (id, value) => {
  const element = document.getElementById(id)
  if (element) element.textContent = value ?? ''
}

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
}

function fullDayAfter(value) {
  const date = new Date(`${value}T00:00:00`)
  date.setDate(date.getDate() + 1)
  return date.toISOString()
}

function recordSummary(entry) {
  const before = entry.before_data || {}
  const after = entry.after_data || {}
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
  if (!changed.length) return 'No field details recorded'
  return changed.map(key => {
    const oldValue = before[key] === undefined ? '—' : JSON.stringify(before[key])
    const newValue = after[key] === undefined ? '—' : JSON.stringify(after[key])
    return `${key}: ${oldValue} → ${newValue}`
  }).join('\n')
}

function currentFilters() {
  return {
    record: document.getElementById('activityRecordSearch')?.value.trim() || '',
    actor: document.getElementById('activityUserFilter')?.value || '',
    action: document.getElementById('activityActionFilter')?.value || '',
    start: document.getElementById('activityStartDate')?.value || '',
    end: document.getElementById('activityEndDate')?.value || '',
    ascending: document.getElementById('activitySort')?.value === 'asc',
  }
}

let activityPage = 1
let settingsInitialized = false
let eventHandlersInitialized = false
let logoPreviewObjectUrl = ''

async function actorNames(ids) {
  const uniqueIds = [...new Set(ids.filter(Boolean))]
  if (!uniqueIds.length) return {}
  const chunks = []
  for (let index = 0; index < uniqueIds.length; index += 100) chunks.push(uniqueIds.slice(index, index + 100))
  const results = await Promise.all(chunks.map(idsChunk =>
    supabase.from('profiles').select('id,name,email').in('id', idsChunk),
  ))
  const failedResult = results.find(result => result.error)
  if (failedResult?.error) throw failedResult.error
  return Object.fromEntries(results.flatMap(result => result.data || []).map(profile => [
    profile.id,
    profile.name || profile.email || profile.id,
  ]))
}

function renderActivityRows(rows, names) {
  const body = document.getElementById('activityLogsBody')
  if (!body) return
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="5">No activity records match these filters.</td></tr>'
    return
  }
  body.innerHTML = rows.map(entry => `
    <tr>
      <td>${escapeHtml(formatDate(entry.created_at))}</td>
      <td>${escapeHtml(names[entry.actor_id] || (entry.actor_role === 'SYSTEM' ? 'System' : entry.actor_id || 'Unknown'))}</td>
      <td>${escapeHtml(entry.action.replace(/_/g, ' '))}</td>
      <td>${escapeHtml(entry.table_name)} · ${escapeHtml(entry.record_id || '—')}</td>
      <td><details><summary>View changes</summary><pre class="audit-diff">${escapeHtml(recordSummary(entry))}</pre></details></td>
    </tr>`).join('')
}

async function loadActorOptions() {
  const select = document.getElementById('activityUserFilter')
  if (!select || select.dataset.loaded) return
  const { data, error } = await supabase
    .from('activity_logs')
    .select('actor_id,actor_role')
    .order('created_at', { ascending: false })
    .limit(1000)
  if (error) throw error

  const ids = [...new Set((data || []).map(row => row.actor_id).filter(Boolean))]
  const names = await actorNames(ids)
  const options = ids.map(id => `<option value="${escapeHtml(id)}">${escapeHtml(names[id] || id)}</option>`)
  if ((data || []).some(row => row.actor_role === 'SYSTEM')) options.push('<option value="SYSTEM">System</option>')
  select.insertAdjacentHTML('beforeend', options.join(''))
  select.dataset.loaded = 'true'
}

async function loadActivityLogs(page = activityPage) {
  activityPage = page
  const body = document.getElementById('activityLogsBody')
  if (!body) return
  body.innerHTML = '<tr><td colspan="5">Loading activity logs...</td></tr>'
  setText('activityLogsCount', 'Loading...')

  try {
    await loadActorOptions()
    const filters = currentFilters()
    let query = supabase.from('activity_logs')
      .select('id,actor_id,actor_role,action,table_name,record_id,before_data,after_data,created_at', { count: 'exact' })
      .order('created_at', { ascending: filters.ascending })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
    if (filters.actor === 'SYSTEM') query = query.eq('actor_role', 'SYSTEM')
    else if (filters.actor) query = query.eq('actor_id', filters.actor)
    if (filters.action) query = query.eq('action', filters.action)
    if (filters.record) query = query.ilike('record_id', `%${filters.record}%`)
    if (filters.start) query = query.gte('created_at', new Date(`${filters.start}T00:00:00`).toISOString())
    if (filters.end) query = query.lt('created_at', fullDayAfter(filters.end))

    const { data, count, error } = await query
    if (error) throw error
    const names = await actorNames((data || []).map(row => row.actor_id))
    renderActivityRows(data || [], names)
    const total = count || 0
    const pages = Math.ceil(total / PAGE_SIZE)
    setText('activityLogsCount', `${total} recorded action${total === 1 ? '' : 's'}`)
    renderPagination('activityLogsPagination', page, pages, loadActivityLogs)
  } catch (error) {
    body.innerHTML = '<tr><td colspan="5">Activity logs could not be loaded.</td></tr>'
    setText('activityLogsCount', 'Unable to load activity logs')
    showToast('Activity logs unavailable', error.message || 'Could not load audit records.', 'error')
  }
}

async function loadRecentActivity() {
  const body = document.getElementById('recentActivityBody')
  if (!body) return
  try {
    const { data, error } = await supabase.from('activity_logs')
      .select('actor_id,actor_role,action,table_name,record_id,created_at')
      .order('created_at', { ascending: false })
      .limit(5)
    if (error) throw error
    if (!data?.length) {
      body.innerHTML = '<tr><td colspan="4">No administrative activity recorded yet.</td></tr>'
      return
    }
    const names = await actorNames(data.map(row => row.actor_id))
    body.innerHTML = data.map(row => `<tr>
      <td>${escapeHtml(formatDate(row.created_at))}</td>
      <td>${escapeHtml(names[row.actor_id] || (row.actor_role === 'SYSTEM' ? 'System' : 'Unknown'))}</td>
      <td>${escapeHtml(row.action.replace(/_/g, ' '))}</td>
      <td>${escapeHtml(row.table_name)} · ${escapeHtml(row.record_id || '—')}</td>
    </tr>`).join('')
  } catch (error) {
    body.innerHTML = '<tr><td colspan="4">Recent activity could not be loaded.</td></tr>'
    console.error('Recent activity load failed:', error)
  }
}

const HEALTH_LABELS = {
  healthy: 'Healthy',
  warning: 'Warning',
  error: 'Error',
  unknown: 'Unknown',
}

function renderHealthStatus(name, item) {
  const statusElement = document.querySelector(`[data-health-status="${name}"]`)
  if (statusElement) {
    const status = HEALTH_LABELS[item?.status] ? item.status : 'unknown'
    statusElement.textContent = HEALTH_LABELS[status]
    statusElement.dataset.status = status
  }
  const detail = item?.result || 'No status has been reported.'
  const timestamp = item?.latestAttemptAt || item?.checkedAt
  const lastSuccess = item?.lastSuccessAt
  const detailElement = document.querySelector(`[data-health-detail="${name}"]`)
  if (detailElement) {
    detailElement.textContent = `${detail}${timestamp ? ` · Last attempt ${formatDate(timestamp)}` : ''}${lastSuccess ? ` · Last success ${formatDate(lastSuccess)}` : ''}`
  }
}

async function loadSystemHealth() {
  const errorsBody = document.getElementById('healthErrorsBody')
  if (!errorsBody) return
  errorsBody.innerHTML = '<tr><td colspan="3">Checking system status...</td></tr>'
  try {
    const { data, error } = await supabase.functions.invoke('system-health')
    if (error) throw error
    for (const component of ['api', 'database', 'telemetry', 'autoAbsence', 'emailNotifications']) {
      renderHealthStatus(component, data?.[component])
    }
    setText('healthCheckedAt', `Checked ${formatDate(data?.api?.checkedAt)}`)
    const rows = data?.recentErrors || []
    errorsBody.innerHTML = rows.length
      ? rows.map(item => `<tr><td>${escapeHtml(formatDate(item.createdAt))}</td><td>${escapeHtml(item.component)}</td><td>${escapeHtml(item.result)}${item.details ? `\n${escapeHtml(JSON.stringify(item.details))}` : ''}</td></tr>`).join('')
      : '<tr><td colspan="3">No recent failures have been reported.</td></tr>'
  } catch (error) {
    for (const component of ['api', 'database', 'telemetry', 'autoAbsence', 'emailNotifications']) {
      renderHealthStatus(component, { status: component === 'api' ? 'error' : 'unknown', result: 'Could not retrieve status.' })
    }
    setText('healthCheckedAt', 'Check failed')
    errorsBody.innerHTML = `<tr><td colspan="3">${escapeHtml(error.message || 'Monitoring checks could not be loaded.')}</td></tr>`
  }
}

async function loadSecurityEvents() {
  const body = document.getElementById('securityEventsBody')
  if (!body) return
  body.innerHTML = '<tr><td colspan="4">Loading security events...</td></tr>'
  try {
    const { data, error } = await supabase.from('activity_logs')
      .select('actor_id,actor_role,action,record_id,created_at')
      .in('action', ['role_changed', 'account_deactivated', 'account_reactivated', 'password_reset'])
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) throw error
    if (!data?.length) {
      body.innerHTML = '<tr><td colspan="4">No security-related administrative events recorded yet.</td></tr>'
      return
    }
    const names = await actorNames(data.map(row => row.actor_id))
    body.innerHTML = data.map(row => `<tr>
      <td>${escapeHtml(formatDate(row.created_at))}</td>
      <td>${escapeHtml(names[row.actor_id] || (row.actor_role === 'SYSTEM' ? 'System' : 'Unknown'))}</td>
      <td>${escapeHtml(row.action.replace(/_/g, ' '))}</td><td>${escapeHtml(row.record_id || '—')}</td>
    </tr>`).join('')
  } catch (error) {
    body.innerHTML = `<tr><td colspan="4">${escapeHtml(error.message || 'Security events could not be loaded.')}</td></tr>`
  }
}

async function loadAuthLoginHistory() {
  const body = document.getElementById('authLoginHistoryBody')
  if (!body) return
  body.innerHTML = '<tr><td colspan="5">Loading sign-in history...</td></tr>'
  setText('authLoginHistoryStatus', 'Loading Supabase Auth audit logs...')
  setText('authLoginHistoryMessage', 'Retrieving recorded sign-in events from Supabase Auth.')
  try {
    const { data, error } = await supabase.rpc('web_admin_auth_login_history', { p_limit: 100 })
    if (error) throw error
    const rows = data || []
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="5">No sign-in events were returned by the Auth audit log.</td></tr>'
      setText('authLoginHistoryStatus', 'Supabase Auth audit log connected')
      setText('authLoginHistoryMessage', 'No sign-in events are currently present in the database audit log. There may be a short delay before new events appear.')
      return
    }
    body.innerHTML = rows.map(row => {
      const user = row.actor_name || row.actor_username || row.actor_id || 'Unknown user'
      const event = row.action === 'mfa_code_login' ? 'MFA sign-in' : 'Sign-in'
      return `<tr>
        <td>${escapeHtml(formatDate(row.event_at))}</td>
        <td>${escapeHtml(user)}</td>
        <td>${escapeHtml(event)}</td>
        <td>${escapeHtml(row.ip_address || 'Not recorded')}</td>
        <td>${escapeHtml(row.provider || 'Not recorded')}</td>
      </tr>`
    }).join('')
    setText('authLoginHistoryStatus', 'Supabase Auth audit log connected')
    setText('authLoginHistoryMessage', `Showing ${rows.length} most recent recorded sign-in event${rows.length === 1 ? '' : 's'}. `)
  } catch (error) {
    const message = String(error?.message || '')
    const migrationMissing = message.includes('web_admin_auth_login_history')
    const storageDisabled = message.includes('audit log database storage is not enabled')
    const status = storageDisabled
      ? 'Supabase Auth audit-log database storage is disabled'
      : migrationMissing
        ? 'Auth login history is not configured'
        : 'Supabase Auth audit logs unavailable'
    const help = storageDisabled
      ? 'Enable “Write audit logs to the database” under Supabase Dashboard → Authentication → Audit Logs, then refresh this page.'
      : migrationMissing
        ? 'Apply the latest database migration and reload the dashboard.'
        : 'Unable to read Auth audit logs. Check the database function deployment and permissions.'
    setText('authLoginHistoryStatus', status)
    setText('authLoginHistoryMessage', help)
    body.innerHTML = '<tr><td colspan="5">No login data is shown because the trusted Auth audit-log source is unavailable.</td></tr>'
  }
}

async function loadBackupHistory() {
  const body = document.getElementById('backupHistoryBody')
  if (!body) return
  body.innerHTML = '<tr><td colspan="8">Loading backup history...</td></tr>'
  try {
    const { data, error } = await supabase.from('system_backup_runs')
      .select('started_at,completed_at,verified_at,status,result,object_key,sha256,size_bytes')
      .order('started_at', { ascending: false })
      .limit(100)
    if (error) throw error
    const runs = data || []
    const verified = runs.find(run => run.status === 'verified' && run.verified_at)
    setText('backupHistorySummary', verified
      ? `Most recent verified backup: ${formatDate(verified.verified_at)}`
      : 'No verified backup has been reported.')
    const setupMessage = document.getElementById('backupSetupMessage')
    if (setupMessage) {
      setupMessage.textContent = verified
        ? 'A successful off-site backup upload has been recorded. Review the latest run and continue performing isolated restore drills.'
        : 'No successful encrypted backup upload has been recorded. Configure the daily GitHub Actions workflow and required repository secrets described in ARCHITECTURE.md.'
    }
    const notice = document.getElementById('backupSetupNotice')
    notice?.classList.remove('hidden')
    body.innerHTML = runs.length ? runs.map(run => `<tr>
      <td>${escapeHtml(formatDate(run.started_at))}</td><td>${escapeHtml(formatDate(run.completed_at))}</td>
      <td>${escapeHtml(formatDate(run.verified_at))}</td><td><span class="health-pill" data-status="${escapeHtml(run.status)}">${escapeHtml(run.status)}</span></td>
      <td>${run.size_bytes ? `${escapeHtml((Number(run.size_bytes) / (1024 * 1024)).toFixed(2))} MiB` : '—'}</td>
      <td><code>${escapeHtml(run.sha256 || '—')}</code></td>
      <td><code>${escapeHtml(run.object_key || '—')}</code></td><td>${escapeHtml(run.result)}</td>
    </tr>`).join('') : '<tr><td colspan="8">No backup history has been reported.</td></tr>'
  } catch (error) {
    setText('backupHistorySummary', 'Backup history is unavailable.')
    body.innerHTML = `<tr><td colspan="8">${escapeHtml(error.message || 'Backup history could not be loaded.')}</td></tr>`
  }
}

const SETTING_FIELDS = [
  ['school_name', 'systemSchoolName', 'text'],
  ['school_year', 'systemSchoolYear', 'text'],
  ['academic_period', 'systemAcademicPeriod', 'text'],
  ['auto_absent_grace_minutes', 'systemAbsenceGrace', 'number'],
  ['late_grace_minutes', 'systemLateGrace', 'number'],
  ['email_notifications_enabled', 'systemEmailEnabled', 'boolean'],
  ['maintenance_announcement', 'systemMaintenance', 'text'],
]

async function loadSystemSettings() {
  const status = document.getElementById('systemSettingsStatus')
  if (!status) return
  status.textContent = 'Loading settings...'
  try {
    const { data, error } = await supabase.from('system_settings').select('key,value')
    if (error) throw error
    const settings = Object.fromEntries((data || []).map(row => [row.key, row.value]))
    for (const [key, id, type] of SETTING_FIELDS) {
      const input = document.getElementById(id)
      if (!input) continue
      const value = settings[key]
      if (type === 'boolean') input.checked = value === true
      else if (value !== undefined && value !== null) input.value = String(value)
    }
    const logoUrl = String(settings.school_logo_url ?? '').trim()
    const logoPreview = document.getElementById('systemSchoolLogoPreview')
    if (logoPreview && /^https:\/\//i.test(logoUrl)) logoPreview.src = logoUrl
    currentSchoolLogoUrl = logoUrl
    const announcement = String(settings.maintenance_announcement ?? '').trim()
    const notice = document.getElementById('systemMaintenanceNotice')
    if (notice) {
      notice.textContent = announcement
      notice.classList.toggle('hidden', !announcement)
    }
    status.textContent = 'Settings loaded'
  } catch (error) {
    settingsInitialized = false
    status.textContent = `Could not load settings: ${error.message || 'Access denied'}`
  }
}

export async function loadPublicSystemSettings() {
  await loadSchoolBranding()
}

let currentSchoolLogoUrl = ''

function uploadedSchoolLogoPath(url) {
  try {
    const pathname = new URL(url).pathname
    const prefix = '/storage/v1/object/public/school-assets/'
    if (!pathname.startsWith(prefix)) return ''
    const path = decodeURIComponent(pathname.slice(prefix.length))
    return path.startsWith('school-logo/') ? path : ''
  } catch {
    return ''
  }
}

async function saveSystemSettings(event) {
  event.preventDefault()
  const form = document.getElementById('systemSettingsForm')
  const button = document.getElementById('saveSystemSettingsBtn')
  const status = document.getElementById('systemSettingsStatus')
  if (!form?.reportValidity()) return
  const logoInput = document.getElementById('systemSchoolLogoFile')
  const logoFile = logoInput?.files?.[0] || null
  const allowedLogoTypes = ['image/png', 'image/jpeg', 'image/webp']
  if (logoFile && (!allowedLogoTypes.includes(logoFile.type) || logoFile.size > 2 * 1024 * 1024)) {
    status.textContent = 'Choose a PNG, JPG, or WebP image no larger than 2 MB.'
    return
  }
  const grace = Number(document.getElementById('systemAbsenceGrace')?.value)
  const lateGrace = Number(document.getElementById('systemLateGrace')?.value)
  if (!Number.isInteger(grace) || grace < 0 || grace > 240 ||
      !Number.isInteger(lateGrace) || lateGrace < 0 || lateGrace > 240) {
    status.textContent = 'Grace period must be a whole number from 0 to 240 minutes.'
    return
  }

  const values = {
    school_name: document.getElementById('systemSchoolName')?.value.trim() || '',
    school_logo_url: currentSchoolLogoUrl,
    school_year: document.getElementById('systemSchoolYear')?.value.trim() || '',
    academic_period: document.getElementById('systemAcademicPeriod')?.value.trim() || '',
    auto_absent_grace_minutes: grace,
    late_grace_minutes: lateGrace,
    email_notifications_enabled: Boolean(document.getElementById('systemEmailEnabled')?.checked),
    maintenance_announcement: document.getElementById('systemMaintenance')?.value.trim() || '',
  }
  button.disabled = true
  status.textContent = 'Saving settings...'
  let uploadedLogoPath = ''
  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) throw userError || new Error('Your session has expired.')
    if (logoFile) {
      const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[logoFile.type]
      uploadedLogoPath = `school-logo/${crypto.randomUUID()}.${extension}`
      const { error: uploadError } = await supabase.storage
        .from('school-assets')
        .upload(uploadedLogoPath, logoFile, { contentType: logoFile.type, upsert: false })
      if (uploadError) throw uploadError
      values.school_logo_url = supabase.storage.from('school-assets').getPublicUrl(uploadedLogoPath).data.publicUrl
    }
    const rows = Object.entries(values).map(([key, value]) => ({
      key,
      value,
      updated_by: user.id,
    }))
    const { error } = await supabase.from('system_settings').upsert(rows, { onConflict: 'key' })
    if (error) throw error
    const oldLogoPath = uploadedLogoPath ? uploadedSchoolLogoPath(currentSchoolLogoUrl) : ''
    currentSchoolLogoUrl = values.school_logo_url
    const logoPreview = document.getElementById('systemSchoolLogoPreview')
    if (logoPreview && values.school_logo_url) logoPreview.src = values.school_logo_url
    if (logoInput) logoInput.value = ''
    if (logoPreviewObjectUrl) URL.revokeObjectURL(logoPreviewObjectUrl)
    logoPreviewObjectUrl = ''
    await loadSchoolBranding()
    if (oldLogoPath) {
      const { error: cleanupError } = await supabase.storage.from('school-assets').remove([oldLogoPath])
      if (cleanupError) console.warn('Previous school logo cleanup failed:', cleanupError.message)
    }
    const notice = document.getElementById('systemMaintenanceNotice')
    if (notice) {
      notice.textContent = values.maintenance_announcement
      notice.classList.toggle('hidden', !values.maintenance_announcement)
    }
    status.textContent = 'Settings saved.'
    showToast('Settings saved', 'System configuration was updated.', 'success')
  } catch (error) {
    if (uploadedLogoPath) {
      const { error: cleanupError } = await supabase.storage.from('school-assets').remove([uploadedLogoPath])
      if (cleanupError) console.warn('Failed to remove an unreferenced school logo upload:', cleanupError.message)
    }
    status.textContent = `Settings not saved: ${error.message || 'The request was rejected.'}`
    showToast('Settings not saved', error.message || 'Could not update system settings.', 'error')
  } finally {
    button.disabled = false
  }
}

export function initAdminSystem() {
  if (document.body.dataset.role !== 'WEB_ADMIN') return
  window.lucide?.createIcons()
  if (!eventHandlersInitialized) {
    eventHandlersInitialized = true
    for (const id of ['activityRecordSearch', 'activityUserFilter', 'activityActionFilter', 'activityStartDate', 'activityEndDate', 'activitySort']) {
      const input = document.getElementById(id)
      input?.addEventListener(id === 'activityRecordSearch' ? 'input' : 'change', () => loadActivityLogs(1))
    }
    document.getElementById('activityRefreshBtn')?.addEventListener('click', () => loadActivityLogs(1))
    document.getElementById('refreshHealthBtn')?.addEventListener('click', loadSystemHealth)
    document.getElementById('refreshBackupsBtn')?.addEventListener('click', loadBackupHistory)
    document.getElementById('refreshAuthLoginHistoryBtn')?.addEventListener('click', loadAuthLoginHistory)
    document.getElementById('systemSettingsForm')?.addEventListener('submit', saveSystemSettings)
    document.getElementById('systemSchoolLogoFile')?.addEventListener('change', event => {
      const file = event.currentTarget.files?.[0]
      const preview = document.getElementById('systemSchoolLogoPreview')
      if (!file || !preview) return
      if (logoPreviewObjectUrl) URL.revokeObjectURL(logoPreviewObjectUrl)
      logoPreviewObjectUrl = URL.createObjectURL(file)
      preview.src = logoPreviewObjectUrl
    })
    window.addEventListener('sectionChange', event => {
      const section = event.detail?.section
      if (section === 'activityLogs') loadActivityLogs(1)
      if (section === 'systemMonitoring') loadSystemHealth()
      if (section === 'security') {
        loadSecurityEvents()
        loadAuthLoginHistory()
      }
      if (section === 'backupRecovery') loadBackupHistory()
      if (section === 'systemSettings' && !settingsInitialized) {
        settingsInitialized = true
        loadSystemSettings()
      }
    })
  }
  loadRecentActivity()
}
