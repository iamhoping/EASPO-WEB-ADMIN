// /js/ui/toast.js

/**
 * Show a toast notification
 * @param {string} title
 * @param {string} msg
 * @param {'success'|'error'|'info'|'warning'} type
 * @param {number} duration ms
 */
export function showToast(title, msg = '', type = 'info', duration = 4000) {
  const container = document.getElementById('toastContainer')
  if (!container) return

  const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' }

  const toast = document.createElement('div')
  toast.className = `toast ${type}`
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || 'ℹ️'}</span>
    <div class="toast-body">
      <div class="toast-title">${title}</div>
      ${msg ? `<div class="toast-msg">${msg}</div>` : ''}
    </div>
    <span class="toast-dismiss" onclick="this.closest('.toast').remove()">✕</span>
  `

  container.appendChild(toast)
  setTimeout(() => toast.remove(), duration)
}