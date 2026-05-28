export function initSettingsSection() {
  const tabs = document.querySelectorAll('.settings-tabs .tab-btn')
  const panels = document.querySelectorAll('.settings-panel')
  if (!tabs.length || !panels.length) return

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.tab
      tabs.forEach(t => t.classList.toggle('active', t === tab))
      panels.forEach(panel => panel.classList.toggle('active', panel.dataset.panel === tabName))
    })
  })
}
