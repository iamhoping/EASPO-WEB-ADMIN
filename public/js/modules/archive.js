import { supabase } from '../services/supabaseClient.js'
import { showToast } from '../ui/toast.js'
import { renderPagination } from '../ui/pagination.js'
import { formatUserName } from '../utils/name-format.js'

const PER_PAGE = 10
const ROLE_LABELS = { STUDENT: 'Student', TEACHER: 'Teacher', PARENT: 'Parent / Guardian' }
let archivedAccounts = []
let filteredAccounts = []
let archivedSectionNames = new Map()
let currentPage = 1
let pendingAccount = null

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character])
}

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString()
}

async function getRequestErrorMessage(error, fallback) {
  const response = error?.context
  let serverMessage = ''
  if (response && typeof response.clone === 'function') {
    try {
      const body = await response.clone().json()
      if (typeof body?.error === 'string' && body.error.trim()) serverMessage = body.error
      else if (typeof body?.message === 'string' && body.message.trim()) serverMessage = body.message
    } catch {
      try {
        const text = await response.clone().text()
        if (text.trim()) serverMessage = text
      } catch {
        serverMessage = error.message || fallback
      }
    }
  }
  if (!serverMessage) serverMessage = error?.message || fallback
  if (serverMessage.includes('Select a supported archive reason')) {
    return 'The deployed archive function is outdated and still requires a reason. Deploy the latest manage-archived-account function, then try again.'
  }
  return serverMessage
}

export async function loadArchivedAccounts() {
  const tbody = document.getElementById('archiveAccountsTableBody')
  if (tbody) tbody.innerHTML = '<tr><td colspan="9"><div class="loader"><div class="spinner"></div></div></td></tr>'
  const { data, error } = await supabase
    .from('profiles')
    .select('id,name,email,role,student_id,teacher_id,grade_level,department,archive_reason,archived_at,archived_by,archived_by_name,archived_section_id')
    .eq('status', 'archived')
    .in('role', ['STUDENT', 'TEACHER', 'PARENT'])
    .order('archived_at', { ascending: false })

  if (error) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><div class="empty-title">Could not load archived accounts</div><div class="empty-sub">${escapeHtml(error.message)}</div></div></td></tr>`
    document.getElementById('archiveAccountsCount').textContent = 'Unable to load archived accounts'
    showToast('Archive unavailable', error.message, 'error')
    return
  }
  archivedAccounts = data || []
  const sectionIds = [...new Set(archivedAccounts.map(account => account.archived_section_id).filter(Boolean))]
  archivedSectionNames = new Map()
  if (sectionIds.length) {
    const { data: sections, error: sectionError } = await supabase
      .from('sections')
      .select('id,name')
      .in('id', sectionIds)
    if (sectionError) showToast('Section names unavailable', sectionError.message, 'error')
    else archivedSectionNames = new Map((sections || []).map(section => [String(section.id), section.name]))
  }
  filterArchivedAccounts()
}

function filterArchivedAccounts() {
  const query = (document.getElementById('archiveSearch')?.value || '').trim().toLowerCase()
  const role = document.getElementById('archiveRoleFilter')?.value || ''
  filteredAccounts = archivedAccounts.filter(account => {
    const searchText = [
      account.id, account.name, account.email, account.student_id, account.teacher_id,
      account.grade_level, account.department, account.archive_reason,
    ].join(' ').toLowerCase()
    return (!query || searchText.includes(query)) && (!role || account.role === role)
  })
  currentPage = 1
  renderArchivedAccounts()
}

function renderArchivedAccounts() {
  const tbody = document.getElementById('archiveAccountsTableBody')
  const count = document.getElementById('archiveAccountsCount')
  if (!tbody) return
  const total = filteredAccounts.length
  if (!total) {
    tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state"><div class="empty-title">No archived accounts found</div><div class="empty-sub">Archived students, teachers, and parents will appear here.</div></div></td></tr>'
    count.textContent = '0 accounts'
    document.getElementById('archiveAccountsPagination').innerHTML = ''
    return
  }
  const start = (currentPage - 1) * PER_PAGE
  const pageAccounts = filteredAccounts.slice(start, start + PER_PAGE)
  const pages = Math.ceil(total / PER_PAGE)
  tbody.innerHTML = pageAccounts.map(account => {
    const accountId = account.student_id || account.teacher_id || account.id
    const academic = account.role === 'STUDENT' ? account.grade_level || '—' : account.department || '—'
    const archivedBy = account.archived_by_name || (account.archived_by ? account.archived_by.slice(0, 8) : '—')
    return `<tr>
      <td data-label="Account"><div class="ent-name">${escapeHtml(formatUserName(account.name) || 'Unnamed account')}</div><div class="ent-sub">${escapeHtml(account.email || '')}</div></td>
      <td data-label="Type"><span class="pill pill-grey">${ROLE_LABELS[account.role] || escapeHtml(account.role)}</span></td>
      <td data-label="Account ID"><code>${escapeHtml(accountId)}</code></td>
      <td data-label="Grade / Department">${escapeHtml(academic)}</td>
      <td data-label="Section">${escapeHtml(archivedSectionNames.get(String(account.archived_section_id)) || account.archived_section_id || '—')}</td>
      <td data-label="Archive Date">${escapeHtml(formatDate(account.archived_at))}</td>
      <td data-label="Archived By"><code>${escapeHtml(archivedBy)}</code></td>
      <td data-label="Actions"><button class="btn btn-secondary btn-sm" type="button" data-restore-account="${escapeHtml(account.id)}" data-account-role="${escapeHtml(account.role)}" data-account-name="${escapeHtml(formatUserName(account.name) || 'this account')}">Restore</button></td>
    </tr>`
  }).join('')
  count.textContent = `Showing ${start + 1}–${Math.min(start + PER_PAGE, total)} of ${total} archived accounts`
  renderPagination('archiveAccountsPagination', currentPage, pages, page => {
    currentPage = page
    renderArchivedAccounts()
  })
}

function openArchiveModal(account) {
  pendingAccount = account
  const name = document.getElementById('archiveAccountName')
  name.textContent = formatUserName(account.name)
  document.getElementById('archiveAccountModal').classList.remove('hidden')
}

async function submitArchive(event) {
  event.preventDefault()
  if (!pendingAccount) return
  const account = pendingAccount
  const submitButton = document.getElementById('confirmArchiveAccount')
  submitButton.disabled = true
  try {
    const { error } = await supabase.functions.invoke('manage-archived-account', {
      body: { action: 'archive', userId: account.id, role: account.role },
    })
    if (error) throw error
  } catch (error) {
    showToast('Account not archived', await getRequestErrorMessage(error, 'Could not archive this account.'), 'error')
    return
  } finally {
    submitButton.disabled = false
  }
  document.getElementById('archiveAccountModal').classList.add('hidden')
  pendingAccount = null
  showToast('Account archived', `${formatUserName(account.name)} was moved to Archived Accounts.`, 'success')
  try {
    await Promise.all([loadArchivedAccounts(), refreshActiveAccountList(account.role)])
  } catch (error) {
    showToast('Account archived; list refresh failed', error.message || 'Reload the account lists to see the update.', 'error')
  }
}

async function restoreAccount(button) {
  const { restoreAccount: id, accountRole: role, accountName: name } = button.dataset
  if (!id || !role || !window.confirm(`Restore "${name}" to the active ${ROLE_LABELS[role] || 'account'} list?`)) return
  button.disabled = true
  try {
    const { error } = await supabase.functions.invoke('manage-archived-account', {
      body: { action: 'restore', userId: id, role },
    })
    if (error) throw error
  } catch (error) {
    showToast('Account not restored', await getRequestErrorMessage(error, 'Could not restore this account.'), 'error')
    button.disabled = false
    return
  }
  showToast('Account restored', `${name} was restored. Students must be assigned to a section again.`, 'success')
  try {
    await Promise.all([loadArchivedAccounts(), refreshActiveAccountList(role)])
  } catch (error) {
    showToast('Account restored; list refresh failed', error.message || 'Reload the account lists to see the update.', 'error')
  }
}

async function refreshActiveAccountList(role) {
  if (role === 'STUDENT') {
    const { loadStudents } = await import('./students.js')
    await loadStudents()
  } else if (role === 'TEACHER') {
    const { loadTeachers } = await import('./teachers.js')
    await loadTeachers()
  } else if (role === 'PARENT') {
    const { loadParents } = await import('./parents.js')
    await loadParents()
  }
  document.dispatchEvent(new CustomEvent('section-student-profile-updated'))
}

export function initArchiveSection() {
  document.getElementById('archiveSearch')?.addEventListener('input', filterArchivedAccounts)
  document.getElementById('archiveRoleFilter')?.addEventListener('change', filterArchivedAccounts)
  document.getElementById('archiveAccountForm')?.addEventListener('submit', submitArchive)
  document.getElementById('archiveAccountCancel')?.addEventListener('click', () => {
    document.getElementById('archiveAccountModal').classList.add('hidden')
    pendingAccount = null
  })
  document.querySelector('[data-close-archive]')?.addEventListener('click', () => {
    document.getElementById('archiveAccountModal').classList.add('hidden')
    pendingAccount = null
  })
  document.addEventListener('click', event => {
    const target = event.target.closest('[data-archive-account]')
    if (target) {
      openArchiveModal({
        id: target.dataset.archiveAccount,
        role: target.dataset.accountRole,
        name: target.dataset.accountName || 'this account',
      })
      return
    }
    const restoreButton = event.target.closest('[data-restore-account]')
    if (restoreButton) restoreAccount(restoreButton)
  })
}
