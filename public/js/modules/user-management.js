// /js/modules/user-management.js
import { supabase } from '../services/supabaseClient.js'
import { showToast } from '../ui/toast.js'

let allUsers = []
let filteredUsers = []
let currentPage = 1
const PER_PAGE = 10

const AV_COLORS = ['av-blue', 'av-green', 'av-yellow', 'av-purple', 'av-red', 'av-orange']
const val = id => (document.getElementById(id)?.value || '').trim()
const setText = (id, value) => {
  const el = document.getElementById(id)
  if (el) el.textContent = value
}
const initials = name => (name || '')
  .split(' ')
  .map(part => part[0] || '')
  .join('')
  .slice(0, 2)
  .toUpperCase() || 'U'
const avColor = name => {
  let sum = 0
  for (const char of (name || '')) sum += char.charCodeAt(0)
  return AV_COLORS[sum % AV_COLORS.length]
}
const escapeHtml = value => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')

function usernameFor(user) {
  return user.username || (user.email || '').split('@')[0] || 'unassigned'
}

function roleLabel(role) {
  return ({
    WEB_ADMIN: 'Administrator',
    STUDENT: 'Student',
    TEACHER: 'Teacher',
    PARENT: 'Parent',
    SCANNER: 'Scanner',
  })[role] || role || 'Unassigned'
}

function rolePill(role) {
  return ({
    WEB_ADMIN: 'pill-purple',
    STUDENT: 'pill-blue',
    TEACHER: 'pill-orange',
    PARENT: 'pill-green',
    SCANNER: 'pill-yellow',
  })[role] || 'pill-grey'
}

function normalizeStatus(status) {
  return (status || 'active').toLowerCase()
}

export async function loadUserManagement() {
  const tbody = document.getElementById('userManagementTableBody')
  if (tbody) tbody.innerHTML = '<tr><td colspan="6"><div class="loader"><div class="spinner"></div></div></td></tr>'
  setText('userManagementCount', 'Loading...')
  setText('userManagementTotal', 'Loading users...')

  const result = await supabase
    .from('profiles')
    .select('id,name,email,role,status')
    .order('name', { ascending: true })

  if (result.error) {
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><div class="empty-title">Could not load users</div><div class="empty-sub">${escapeHtml(result.error.message)}</div></div></td></tr>`
    }
    setText('userManagementCount', 'Unable to load users')
    setText('userManagementTotal', '0 users')
    showToast('DB Error', result.error.message, 'error')
    return
  }

  allUsers = result.data || []
  applyUserManagementFilters()
}

export function applyUserManagementFilters() {
  const query = val('userManagementSearch').toLowerCase()
  const role = document.getElementById('userManagementRoleFilter')?.value || ''
  const status = document.getElementById('userManagementStatusFilter')?.value || ''
  const direction = document.getElementById('userManagementSort')?.value || 'asc'

  filteredUsers = allUsers
    .filter(user => {
      const userStatus = normalizeStatus(user.status)
      const haystack = [
        user.name,
        user.email,
        usernameFor(user),
        roleLabel(user.role),
        user.role,
      ].join(' ').toLowerCase()

      return (!query || haystack.includes(query)) &&
        (!role || user.role === role) &&
        (!status || userStatus === status)
    })
    .sort((a, b) => {
      const left = (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' })
      return direction === 'desc' ? -left : left
    })

  currentPage = 1
  renderUsers()
}

function renderUsers() {
  const tbody = document.getElementById('userManagementTableBody')
  const countEl = document.getElementById('userManagementCount')
  const totalEl = document.getElementById('userManagementTotal')
  if (!tbody) return

  const total = filteredUsers.length
  const allTotal = allUsers.length
  if (totalEl) totalEl.textContent = `${allTotal} registered user${allTotal === 1 ? '' : 's'}`

  if (!total) {
    tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><div class="empty-title">No users found</div><div class="empty-sub">Adjust your search, role, status, or sort controls.</div></div></td></tr>'
    if (countEl) countEl.textContent = '0 users'
    const pagination = document.getElementById('userManagementPagination')
    if (pagination) pagination.innerHTML = ''
    return
  }

  const start = (currentPage - 1) * PER_PAGE
  const slice = filteredUsers.slice(start, start + PER_PAGE)
  const pages = Math.ceil(total / PER_PAGE)

  tbody.innerHTML = slice.map(user => {
    const status = normalizeStatus(user.status)
    const statusLabel = status.charAt(0).toUpperCase() + status.slice(1)
    const name = user.name || 'Unnamed User'
    const username = usernameFor(user)

    return `
      <tr>
        <td data-label="Full Name">
          <div class="ent-row">
            <div class="av ${avColor(name)}">${escapeHtml(initials(name))}</div>
            <div>
              <div class="ent-name">${escapeHtml(name)}</div>
              <div class="ent-sub">${escapeHtml(user.id)}</div>
            </div>
          </div>
        </td>
        <td data-label="Username"><code class="user-management-username">${escapeHtml(username)}</code></td>
        <td data-label="Email">${escapeHtml(user.email || '-')}</td>
        <td data-label="Role"><span class="pill ${rolePill(user.role)}">${escapeHtml(roleLabel(user.role))}</span></td>
        <td data-label="Status"><span class="pill ${status === 'active' ? 'pill-green' : 'pill-grey'}">${escapeHtml(statusLabel)}</span></td>
        <td data-label="Actions">
          <button class="btn btn-secondary btn-sm" type="button" onclick="openChangeUserPasswordModal('${escapeHtml(user.id)}')">Change Password</button>
        </td>
      </tr>
    `
  }).join('')

  if (countEl) countEl.textContent = `Showing ${start + 1}-${Math.min(start + PER_PAGE, total)} of ${total} users`
  renderPages('userManagementPagination', currentPage, pages, page => {
    currentPage = page
    renderUsers()
  })
}

export function openChangeUserPasswordModal(userId) {
  const user = allUsers.find(item => item.id === userId)
  if (!user) return showToast('User not found', 'Refresh the user list and try again.', 'warning')

  const name = user.name || 'Unnamed User'
  document.getElementById('changePasswordUserId').value = user.id
  setText('changePasswordName', name)
  setText('changePasswordEmail', user.email || usernameFor(user))
  setText('changePasswordInitials', initials(name))
  document.getElementById('changePasswordNew').value = ''
  document.getElementById('changePasswordConfirm').value = ''
  updatePasswordRules()
  document.getElementById('changeUserPasswordModal')?.classList.remove('hidden')
  document.getElementById('changePasswordNew')?.focus()
}

function passwordValidation(password, confirm) {
  return {
    length: password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    number: /\d/.test(password),
    match: password.length > 0 && password === confirm,
  }
}

function updatePasswordRules() {
  const password = val('changePasswordNew')
  const confirm = val('changePasswordConfirm')
  const checks = passwordValidation(password, confirm)

  document.querySelectorAll('#changePasswordRules [data-rule]').forEach(rule => {
    const passed = Boolean(checks[rule.dataset.rule])
    rule.classList.toggle('passed', passed)
  })

  return Object.values(checks).every(Boolean)
}

export async function submitChangeUserPassword() {
  const userId = val('changePasswordUserId')
  const password = val('changePasswordNew')
  const confirmPassword = val('changePasswordConfirm')
  const user = allUsers.find(item => item.id === userId)

  if (!user) return showToast('User not found', 'Refresh the user list and try again.', 'warning')
  if (!updatePasswordRules()) {
    return showToast('Invalid password', 'Use 8 characters, one uppercase letter, one number, and matching confirmation.', 'warning')
  }

  if (!window.confirm(`Change password for ${user.name || user.email || 'this user'}?`)) return

  const saveBtn = document.getElementById('saveUserPasswordBtn')
  const originalText = saveBtn?.textContent || 'Save Password'
  if (saveBtn) {
    saveBtn.disabled = true
    saveBtn.textContent = 'Saving...'
  }

  try {
    const { error } = await supabase.functions.invoke('change-user-password', {
      body: { userId, password, confirmPassword },
    })

    if (error) throw error

    showToast('Password updated', `${user.name || user.email}'s password was changed successfully.`, 'success')
    document.getElementById('changeUserPasswordModal')?.classList.add('hidden')
    document.getElementById('changeUserPasswordForm')?.reset()
  } catch (error) {
    showToast('Password update failed', await functionErrorMessage(error), 'error')
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false
      saveBtn.textContent = originalText
    }
  }
}

async function functionErrorMessage(error) {
  if (error?.context?.json) {
    try {
      const body = await error.context.json()
      if (body?.error) return body.error
    } catch {
      // Fall through to the generic message below.
    }
  }

  return error?.message || 'Could not change the password.'
}

export function initUserManagementSection() {
  document.getElementById('userManagementSearch')?.addEventListener('input', applyUserManagementFilters)
  document.getElementById('userManagementRoleFilter')?.addEventListener('change', applyUserManagementFilters)
  document.getElementById('userManagementStatusFilter')?.addEventListener('change', applyUserManagementFilters)
  document.getElementById('userManagementSort')?.addEventListener('change', applyUserManagementFilters)
  document.getElementById('changePasswordNew')?.addEventListener('input', updatePasswordRules)
  document.getElementById('changePasswordConfirm')?.addEventListener('input', updatePasswordRules)
  loadUserManagement()
}

function renderPages(id, cur, total, onChange) {
  const el = document.getElementById(id)
  if (!el || total <= 1) {
    if (el) el.innerHTML = ''
    return
  }

  const pages = []
  if (cur > 1) pages.push({ label: '&lt;', page: cur - 1 })

  for (let i = 1; i <= total; i += 1) {
    if (i === 1 || i === total || Math.abs(i - cur) <= 1) {
      pages.push({ label: i, page: i, active: i === cur })
    } else if (pages[pages.length - 1]?.label !== '...') {
      pages.push({ label: '...', page: null })
    }
  }

  if (cur < total) pages.push({ label: '&gt;', page: cur + 1 })

  el.innerHTML = pages.map(page => `
    <button class="page-btn ${page.active ? 'active' : ''}" data-page="${page.page || ''}" ${page.page === null ? 'disabled' : ''}>
      ${page.label}
    </button>
  `).join('')

  el.onclick = event => {
    const button = event.target.closest('.page-btn')
    if (!button) return
    const page = Number(button.dataset.page)
    if (!Number.isNaN(page) && page !== cur) onChange(page)
  }
}

window.openChangeUserPasswordModal = openChangeUserPasswordModal
window.submitChangeUserPassword = submitChangeUserPassword
