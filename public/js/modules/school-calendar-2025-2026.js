export const SCHOOL_YEAR_2025_2026 = {
  label: 'School Year 2025–2026',
  startDate: '2025-06-16',
  endDate: '2026-03-31',
  displayEndDate: '2026-12-31',
  source: 'https://www.deped.gov.ph/wp-content/uploads/DO_s2025_012.pdf',
  breaks: [
    {
      startDate: '2025-10-27',
      endDate: '2025-10-31',
      label: 'Mid-School Year Wellness Break'
    },
    {
      startDate: '2025-12-20',
      endDate: '2026-01-01',
      label: 'Christmas Break'
    }
  ],
  holidays: {
    '2025-08-21': 'Ninoy Aquino Day (Special Non-Working Holiday)',
    '2025-08-25': 'National Heroes Day (Regular Holiday)',
    '2025-10-31': 'All Saints’ Day Eve (Special Non-Working Holiday)',
    '2025-11-01': 'All Saints’ Day (Non-Working Holiday)',
    '2025-11-02': 'All Souls’ Day (Holiday)',
    '2025-11-30': 'Andres Bonifacio Day (Regular Holiday)',
    '2025-12-08': 'Feast of the Immaculate Conception',
    '2025-12-24': 'Christmas Eve (Special Non-Working Holiday)',
    '2025-12-25': 'Christmas Day (Regular Holiday)',
    '2025-12-30': 'Rizal Day (Regular Holiday)',
    '2025-12-31': 'Last Day of the Year (Special Non-Working Holiday)',
    '2026-01-01': 'New Year’s Day (Regular Holiday)',
    '2026-02-17': 'Chinese New Year (Regular Holiday)'
  }
}

export function getSchoolCalendarEvent(dateString) {
  const holiday = SCHOOL_YEAR_2025_2026.holidays[dateString]
  if (holiday) return { type: 'holiday', label: holiday }

  const schoolBreak = SCHOOL_YEAR_2025_2026.breaks.find(({ startDate, endDate }) =>
    dateString >= startDate && dateString <= endDate
  )
  return schoolBreak ? { type: 'break', label: schoolBreak.label } : null
}

export function isSchoolDay(dateString) {
  if (dateString < SCHOOL_YEAR_2025_2026.startDate || dateString > SCHOOL_YEAR_2025_2026.endDate) return false

  const date = new Date(`${dateString}T00:00:00`)
  const weekday = date.getDay()
  return weekday !== 0 && weekday !== 6 && !getSchoolCalendarEvent(dateString)
}
