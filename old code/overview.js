import { loadDashboard, getDashboardCounts } from './dashboard.js'

export function initOverviewSection() {
  const monthInput = document.getElementById('chartMonth')
  if (!monthInput) return

  const current = new Date()
  monthInput.value = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`

  // Load dashboard counts and chart on page load
  getDashboardCounts()
  loadDashboard(monthInput.value)

  window.refreshChart = async function () {
    await loadDashboard(monthInput.value)
  }
}
