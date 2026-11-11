export function formatTime12Hour(value) {
  const time = String(value ?? '').trim()
  const match = time.match(/^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:\s*(AM|PM))?$/i)
  if (!match) return time || '—'

  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return time

  const period = match[3]?.toUpperCase() || (hour < 12 ? 'AM' : 'PM')
  const displayHour = hour % 12 || 12
  return `${displayHour}:${String(minute).padStart(2, '0')} ${period}`
}
