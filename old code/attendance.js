export function initAttendanceSection() {
  const section = document.getElementById('attendanceSection')
  if (!section) return

  const manualEntryButton = section.querySelector('.manage-actions .btn-primary')
  const exportButton = section.querySelector('.manage-actions .btn-secondary')
  const searchInput = section.querySelector('.section-search input')
  const dateInput = section.querySelector('#attendanceDatePicker')

  const today = new Date()
  if (dateInput) {
    dateInput.value = today.toISOString().slice(0, 10)
  }

  manualEntryButton?.addEventListener('click', () => {
    console.log('Attendance Logs -> Manual Entry')
  })

  exportButton?.addEventListener('click', () => {
    console.log('Attendance Logs -> Export')
  })

  searchInput?.addEventListener('input', event => {
    console.log('Attendance Logs search:', event.target.value)
  })
}
