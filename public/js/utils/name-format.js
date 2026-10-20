function titleCaseNamePart(value) {
  return value
    .split(/(\s+|[-'’])/)
    .map(part => {
      if (!part || /^\s+$/.test(part) || /^[-'’]$/.test(part)) return part
      if (/^(?:[ivxlcdm]+)\.?$/i.test(part) && (part.length >= 3 || part === part.toLocaleUpperCase())) {
        return part.toLocaleUpperCase()
      }
      const [first, ...rest] = part.toLocaleLowerCase()
      return `${first.toLocaleUpperCase()}${rest.join('')}`
    })
    .join('')
}

export function formatUserName(value) {
  const name = String(value ?? '').trim().replace(/\s+/g, ' ')
  if (!name.includes(',')) return titleCaseNamePart(name)

  const parts = name.split(',').map(part => part.trim()).filter(Boolean)
  if (parts.length < 2) return titleCaseNamePart(name)
  return `${titleCaseNamePart(parts[0])}, ${titleCaseNamePart(parts.slice(1).join(' '))}`
}

export function isLastFirstName(value) {
  const name = String(value ?? '').trim()
  const parts = name.split(',')
  return parts.length >= 2 && parts.every(part => Boolean(part.trim()))
}

export function initialsForUserName(value) {
  const name = formatUserName(value)
  if (!name.includes(',')) {
    return name.split(/\s+/).map(part => part[0] || '').join('').slice(0, 2).toUpperCase() || '??'
  }
  const [lastName, firstNames] = name.split(',', 2)
  return `${lastName.trim()[0] || ''}${firstNames.trim()[0] || ''}`.toUpperCase() || '??'
}
