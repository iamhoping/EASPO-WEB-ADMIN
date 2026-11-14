import { supabase } from '../services/supabaseClient.js'
import { showToast } from '../ui/toast.js'

const BUCKET = 'easpo-backups'
const MAX_FILE_BYTES = 10 * 1024 * 1024
const DATASETS = [
  ['students', 'Students'],
  ['teachers', 'Teachers'],
  ['parents', 'Parents'],
  ['school_admins', 'School administrators'],
  ['web_admins', 'Web administrators'],
  ['scanners', 'Scanners'],
  ['sections', 'Sections'],
  ['subjects', 'Subjects'],
  ['schedules', 'Schedules'],
  ['grades', 'Grades'],
  ['attendance', 'Attendance'],
  ['system_settings', 'System settings'],
]

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

let handlersInitialized = false
let importedPath = ''
let importedPreview = null
let restoreReport = null

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
}

function formatRange(from, to) {
  if (!from && !to) return 'All dates'
  if (from && to) return `${from} to ${to}`
  return from ? `From ${from}` : `Through ${to}`
}

function safeFilename(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function wrapPdfText(value) {
  return String(value ?? '').replace(/(\S{18})(?=\S)/g, '$1\n')
}

function pdfTable(headers, rows) {
  const fontSize = Math.max(4, Math.min(6, 66 / Math.max(headers.length, 1)))
  const body = [
    headers.map(value => ({ text: wrapPdfText(value), bold: true, fillColor: '#e8eef5', fontSize })),
    ...rows.map(row => headers.map((_, index) => ({ text: wrapPdfText(row[index]), fontSize }))),
  ]
  return [{
    table: { headerRows: 1, widths: headers.map(() => '*'), body, dontBreakRows: true, keepWithHeaderRows: 1 },
    layout: {
      hLineColor: () => '#9ca3af',
      vLineColor: () => '#cbd5e1',
      paddingLeft: () => 1,
      paddingRight: () => 1,
      paddingTop: () => 2,
      paddingBottom: () => 2,
    },
  }]
}

async function loadExportBranding() {
  const { data, error } = await supabase.rpc('get_public_school_branding')
  if (error) throw error
  const settings = Object.fromEntries((data || []).map(row => [row.key, row.value]))
  const fallbackLogo = document.querySelector('[data-school-logo]:not(link), .sidebar-logo')?.src ||
    new URL('../../logo.png', import.meta.url).href
  const logoUrl = String(settings.school_logo_url || fallbackLogo).trim()
  const response = await fetch(logoUrl)
  if (!response.ok) throw new Error('The school logo could not be loaded for the export.')
  const logoBlob = await response.blob()
  const objectUrl = URL.createObjectURL(logoBlob)
  try {
    const image = new Image()
    await new Promise((resolve, reject) => {
      image.onload = resolve
      image.onerror = () => reject(new Error('The school logo could not be prepared for the export.'))
      image.src = objectUrl
    })
    if (!image.naturalWidth || !image.naturalHeight) {
      throw new Error('The school logo has invalid image dimensions.')
    }
    const scale = Math.min(1, 512 / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('The school logo could not be processed for the export.')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return {
      name: String(settings.school_name || 'Eastern Porac National High School').trim(),
      address: String(settings.school_address || '').trim() || 'School address not configured',
      logo: canvas.toDataURL('image/png'),
    }
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

function styleWorkbookHeader(row) {
  row.height = 24
  row.font = { bold: true, color: { argb: 'FF17365D' } }
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF5' } }
  row.alignment = { vertical: 'middle', wrapText: true }
}

function addWorkbookBranding(sheet, logoId, branding, title) {
  sheet.addImage(logoId, 'A1:B4')
  sheet.mergeCells('C1:H1')
  sheet.mergeCells('C2:H2')
  sheet.mergeCells('C3:H3')
  sheet.mergeCells('C5:H5')
  sheet.mergeCells('C6:H6')
  sheet.getCell('C1').value = branding.name
  sheet.getCell('C1').font = { bold: true, size: 16, color: { argb: 'FF17365D' } }
  sheet.getCell('C2').value = branding.address
  sheet.getCell('C2').font = { size: 10, color: { argb: 'FF4B5563' } }
  sheet.getCell('C3').value = 'Backup & Restore'
  sheet.getCell('C3').font = { bold: true, size: 10, color: { argb: 'FF4B5563' } }
  sheet.getCell('C5').value = title
  sheet.getCell('C5').font = { bold: true, size: 13, color: { argb: 'FF111827' } }
  sheet.getCell('C6').value = `Generated ${new Date().toLocaleString()}`
  sheet.getCell('C6').font = { size: 9, color: { argb: 'FF6B7280' } }
  sheet.getRow(1).height = 28
  sheet.getRow(2).height = 20
  sheet.getRow(3).height = 20
  sheet.getRow(5).height = 22
  sheet.getRow(6).height = 18
}

async function downloadExcelReport(report, branding, filename) {
  const ExcelJS = window.ExcelJS
  if (!ExcelJS?.Workbook) throw new Error('Excel export is unavailable. Reload the page and try again.')
  const workbook = new ExcelJS.Workbook()
  workbook.creator = branding.name
  workbook.subject = report.title
  workbook.created = new Date()
  const logoId = workbook.addImage({ base64: branding.logo, extension: 'png' })

  const infoSheet = workbook.addWorksheet('Backup Info')
  addWorkbookBranding(infoSheet, logoId, branding, report.title)
  infoSheet.getColumn(1).width = 28
  infoSheet.getColumn(2).width = 52
  infoSheet.addRow([])
  styleWorkbookHeader(infoSheet.addRow(['Report details', 'Value']))
  for (const [label, value] of report.metadata || []) infoSheet.addRow([label, value ?? ''])

  if (report.sheets) {
    infoSheet.addRow([])
    styleWorkbookHeader(infoSheet.addRow(['Dataset', 'Records']))
    for (const sheet of report.sheets) infoSheet.addRow([sheet.name, sheet.rows.length])

    for (const dataset of report.sheets) {
      const worksheet = workbook.addWorksheet(dataset.name.slice(0, 31))
      addWorkbookBranding(worksheet, logoId, branding, dataset.name)
      worksheet.addRow([])
      const headerRow = worksheet.addRow(dataset.headers)
      styleWorkbookHeader(headerRow)
      dataset.headers.forEach((header, index) => {
        const column = worksheet.getColumn(index + 1)
        column.width = Math.min(32, Math.max(14, String(header).length + 2))
        column.alignment = { vertical: 'top', wrapText: true }
      })
      for (const row of dataset.rows) worksheet.addRow(row)
      worksheet.views = [{ state: 'frozen', ySplit: headerRow.number }]
      worksheet.autoFilter = {
        from: { row: headerRow.number, column: 1 },
        to: { row: Math.max(headerRow.number, worksheet.rowCount), column: Math.max(dataset.headers.length, 1) },
      }
      worksheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
    }
  } else {
    infoSheet.addRow([])
    const headerRow = infoSheet.addRow(report.headers)
    styleWorkbookHeader(headerRow)
    report.rows.forEach(row => infoSheet.addRow(row))
  }

  const buffer = await workbook.xlsx.writeBuffer()
  const file = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = `${filename}.xlsx`
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function downloadReport(report, format) {
  if (!report?.rows?.length) {
    showToast('Report unavailable', 'There is no backup or restore information to export yet.', 'warning')
    return
  }
  const filename = `${safeFilename(report.title)}-${new Date().toISOString().slice(0, 10)}`
  try {
    const branding = await loadExportBranding()
    if (format === 'excel') {
      await downloadExcelReport(report, branding, filename)
    } else {
      if (!window.pdfMake?.createPdf) throw new Error('PDF export is unavailable. Reload the page and try again.')
      const content = [
        {
          columns: [
            { image: branding.logo, width: 58, height: 58, fit: [58, 58] },
            {
              stack: [
                { text: branding.name, style: 'schoolName' },
                { text: branding.address, style: 'schoolAddress' },
                { text: 'Backup & Restore', style: 'schoolAddress' },
              ],
              margin: [12, 8, 0, 0],
            },
          ],
          columnGap: 12,
          margin: [0, 0, 0, 14],
        },
        { text: report.title, style: 'title' },
        { text: `Generated: ${new Date().toLocaleString()}`, margin: [0, 0, 0, 10] },
        ...(report.metadata || []).map(([label, value]) => ({
          text: [{ text: `${label}: `, bold: true }, String(value ?? '')],
          style: 'metadata',
        })),
      ]
      if (report.sheets) {
        report.sheets.forEach(sheet => {
          content.push({ text: sheet.name, style: 'sectionHeading', margin: [0, 12, 0, 5] })
          if (!sheet.rows.length) {
            content.push(...pdfTable(['Status'], [['No records in this dataset']]))
            return
          }
          content.push(...pdfTable(sheet.headers, sheet.rows))
        })
      } else {
        content.push(...pdfTable(report.headers, report.rows))
      }
      window.pdfMake.createPdf({
        pageOrientation: 'landscape',
        pageMargins: [14, 24, 14, 24],
        content,
        defaultStyle: { font: 'Roboto', fontSize: 7 },
        styles: {
          schoolName: { fontSize: 16, bold: true, color: '#17365d' },
          schoolAddress: { fontSize: 9, color: '#4b5563', margin: [0, 3, 0, 0] },
          title: { fontSize: 16, bold: true, margin: [0, 0, 0, 8] },
          metadata: { fontSize: 8, margin: [0, 1, 0, 1] },
          sectionHeading: { fontSize: 11, bold: true },
        },
      }).download(`${filename}.pdf`)
    }
    showToast('Download ready', `The ${format.toUpperCase()} report was downloaded.`, 'success')
  } catch (error) {
    showToast('Download failed', error.message || `The ${format.toUpperCase()} report could not be downloaded.`, 'error')
  }
}

function cellValue(value) {
  if (value === null || value === undefined) return ''
  return typeof value === 'object' ? JSON.stringify(value) : value
}

function createBackupReport(run, backup) {
  const isDataBackup = run.backup_type === 'data_export'
  const datasetNames = backup.tables || []
  const datasets = datasetNames.map(name => ({
    name,
    label: DATASETS.find(([key]) => key === name)?.[1] || name,
    records: backup.records?.[name] || [],
  }))
  const totalRecords = datasets.reduce((total, dataset) => total + dataset.records.length, 0)
  const backupDate = formatDate(run.started_at)
  return {
    title: `EASPO Backup ${String(run.started_at || '').slice(0, 10)} ${String(run.id).slice(0, 8)}`,
    metadata: [
      ['Backup ID', run.id],
      ['Backup date', backupDate],
      ['Date range', isDataBackup ? formatRange(backup.filters?.dateFrom, backup.filters?.dateTo) : '—'],
      ['File size', run.size_bytes ? `${(Number(run.size_bytes) / (1024 * 1024)).toFixed(2)} MiB` : '—'],
      ['Status', isDataBackup ? run.status : `${run.status} · legacy dump`],
      ['Backup type', isDataBackup ? 'Selective data backup' : 'Legacy database dump'],
      ['Total records', totalRecords],
    ],
    headers: ['Dataset', 'Records'],
    rows: datasets.map(dataset => [dataset.label, dataset.records.length]),
    sheets: datasets.map(dataset => {
      const columns = [...new Set(dataset.records.flatMap(record => Object.keys(record)))]
      return {
        name: DATASETS.find(([key]) => key === dataset.name)?.[1] || dataset.name,
        headers: columns.length ? columns : ['No records'],
        rows: dataset.records.map(record => columns.map(column => cellValue(record[column]))),
      }
    }),
  }
}

async function exportBackupReport(button, format, runs) {
  const run = runs.find(item => String(item.id) === button.dataset.backupId)
  if (!run) {
    showToast('Report unavailable', 'The selected backup history entry could not be found. Refresh the history and try again.', 'error')
    return
  }
  button.disabled = true
  const originalText = button.textContent
  button.textContent = 'Preparing…'
  try {
    const result = await invokeBackup('export-data', { id: run.id })
    if (!result.backup?.records || !Array.isArray(result.backup.tables)) {
      throw new Error('The selected backup did not contain readable dataset records.')
    }
    await downloadReport(createBackupReport(run, result.backup), format)
  } catch (error) {
    if (error.message === 'Unsupported backup operation.') {
      showToast(
        'Backup service update required',
        'The deployed selective-backup function is outdated. Deploy the updated function, then retry the export.',
        'error',
      )
    } else {
      showToast('Download failed', error.message || 'The backup data could not be exported.', 'error')
    }
  } finally {
    button.disabled = false
    button.textContent = originalText
  }
}

async function invokeBackup(action, values = {}) {
  const { data, error } = await supabase.functions.invoke('selective-backup', {
    body: { action, ...values },
  })
  if (error) {
    const result = error.context
    if (result && typeof result.clone === 'function') {
      let body = null
      try {
        body = await result.clone().json()
      } catch {
        body = null
      }
      if (typeof body?.error === 'string' && body.error.trim()) throw new Error(body.error)
    }
    throw error
  }
  if (!data?.ok) throw new Error(data?.error || 'The backup request did not complete.')
  return data
}

function selectedDatasets() {
  return [...document.querySelectorAll('[data-backup-dataset]:checked')]
    .map(input => input.value)
}

function setBackupBusy(busy) {
  const button = document.getElementById('backupNowBtn')
  if (button) {
    button.disabled = busy
    button.textContent = busy ? 'Creating encrypted backup…' : 'Backup Now'
  }
}

async function createBackup() {
  const tables = selectedDatasets()
  if (!tables.length) {
    showToast('Backup not started', 'Select at least one data set.', 'warning')
    return
  }
  const dateFrom = document.getElementById('backupDateFrom')?.value || null
  const dateTo = document.getElementById('backupDateTo')?.value || null
  if (dateFrom && dateTo && dateFrom > dateTo) {
    showToast('Backup not started', 'The start date must not be after the end date.', 'warning')
    return
  }

  setBackupBusy(true)
  setText('backupActionMessage', 'Reading selected data, encrypting the backup, and saving it to private Supabase Storage…')
  try {
    const result = await invokeBackup('create', { tables, dateFrom, dateTo })
    window.location.assign(result.downloadUrl)
    setText('backupActionMessage', `Backup created and downloaded (${result.records.toLocaleString()} record(s)).`)
    showToast('Backup complete', `${result.records.toLocaleString()} record(s) were saved to an encrypted backup file.`, 'success')
    await loadBackupHistory()
  } catch (error) {
    setText('backupActionMessage', `Backup failed: ${error.message || 'The backup could not be created.'}`)
    showToast('Backup failed', error.message || 'The backup could not be created.', 'error')
    await loadBackupHistory()
  } finally {
    setBackupBusy(false)
  }
}

function clearPreview() {
  importedPreview = null
  const preview = document.getElementById('restorePreview')
  if (preview) {
    preview.classList.add('hidden')
    preview.textContent = ''
  }
  const restoreButton = document.getElementById('restoreBackupBtn')
  if (restoreButton) restoreButton.disabled = true
  document.getElementById('discardRestoreFileBtn')?.classList.add('hidden')
}

function clearRestoreResults() {
  const results = document.getElementById('restoreResults')
  if (results) {
    results.classList.add('hidden')
    results.textContent = ''
  }
}

async function discardImport() {
  const path = importedPath
  if (!path) {
    clearPreview()
    return true
  }
  try {
    await invokeBackup('discard-import', { path })
    importedPath = ''
    clearPreview()
    return true
  } catch (error) {
    console.warn('Temporary backup upload cleanup failed:', error.message)
    importedPreview = null
    const restoreButton = document.getElementById('restoreBackupBtn')
    if (restoreButton) restoreButton.disabled = true
    document.getElementById('discardRestoreFileBtn')?.classList.remove('hidden')
    setText('restoreActionMessage', `Temporary backup file was not removed: ${error.message || 'Storage cleanup failed.'}`)
    showToast('Cleanup failed', error.message || 'The temporary backup file could not be removed.', 'error')
    return false
  }
}

async function previewBackup() {
  const file = document.getElementById('restoreBackupFile')?.files?.[0]
  if (!file) {
    showToast('Preview unavailable', 'Choose an EASPO backup file first.', 'warning')
    return
  }
  if (file.size > MAX_FILE_BYTES) {
    showToast('Preview unavailable', 'Choose a backup file no larger than 10 MiB.', 'warning')
    return
  }
  if (!file.name.toLowerCase().endsWith('.easpobackup')) {
    showToast('Preview unavailable', 'Choose an .easpobackup file created by EASPO.', 'warning')
    return
  }

  const button = document.getElementById('previewBackupBtn')
  if (button) {
    button.disabled = true
    button.textContent = 'Validating…'
  }
  clearRestoreResults()
  setText('restoreActionMessage', 'Uploading the encrypted file to a private temporary location and validating its integrity…')
  clearPreview()
  try {
    if (!await discardImport()) return
    const ticket = await invokeBackup('upload-ticket', { fileSize: file.size })
    importedPath = ticket.path
    const { error: uploadError } = await supabase.storage.from(BUCKET)
      .uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: 'application/octet-stream', upsert: false })
    if (uploadError) throw new Error(`The backup file could not be uploaded: ${uploadError.message}`)
    importedPreview = await invokeBackup('preview', { path: importedPath })

    const tables = importedPreview.tables
      .map(table => `${table.name}: ${Number(table.records).toLocaleString()} record(s)${table.records === 0 ? ' — empty' : ''}`)
      .join('\n')
    const range = formatRange(importedPreview.dateFrom, importedPreview.dateTo)
    const zeroWarnings = importedPreview.zeroRecordWarnings || []
    const missingWarnings = importedPreview.missingTableWarnings || []
    const warningLines = []
    if (!importedPreview.hasAuthIdentitySnapshot) {
      warningLines.push('This older backup has no Auth identity snapshot. Accounts can only be restored if their original Supabase Auth identities still exist.')
    }
    if (zeroWarnings.length) {
      warningLines.push(`WARNING: This backup has zero ${zeroWarnings.join(', ')} records. These records cannot be recovered from this backup.`)
    }
    if (missingWarnings.length) {
      warningLines.push(`WARNING: This backup does not include ${missingWarnings.join(', ')}. Those records cannot be recovered from this backup.`)
    }
    const warning = warningLines.length ? `\n\n${warningLines.join('\n')}` : ''
    restoreReport = {
      title: 'EASPO Restore Report',
      metadata: [
        ['Backup created', formatDate(importedPreview.createdAt)],
        ['Date filters', range],
        ['Total records', Number(importedPreview.totalRecords).toLocaleString()],
        ['Status', 'Validated; awaiting restore'],
      ],
      headers: ['Dataset', 'Backup records', 'Restore status'],
      rows: importedPreview.tables.map(table => [table.name, Number(table.records), 'Awaiting restore']),
    }
    document.getElementById('restoreExportActions')?.classList.remove('hidden')
    setText('restorePreview',
      `Backup created: ${formatDate(importedPreview.createdAt)}\n` +
      `Date filters: ${range}\n` +
      `Total records: ${Number(importedPreview.totalRecords).toLocaleString()}\n` +
      `Included tables:\n${tables}${warning}`)
    document.getElementById('restorePreview')?.classList.remove('hidden')
    document.getElementById('restoreBackupBtn').disabled = false
    document.getElementById('discardRestoreFileBtn')?.classList.remove('hidden')
    setText('restoreActionMessage', 'Backup integrity and format validated. Review the preview before restoring.')
  } catch (error) {
    const removed = await discardImport()
    setText('restoreActionMessage', `Preview failed: ${error.message || 'The backup file could not be validated.'}`)
    if (!removed) setText('restoreActionMessage', `Preview failed: ${error.message || 'The backup file could not be validated.'} The temporary uploaded file could not be removed; retry cleanup before continuing.`)
    showToast('Preview failed', error.message || 'The backup file could not be validated.', 'error')
  } finally {
    if (button) {
      button.disabled = false
      button.textContent = 'Validate and Preview'
    }
  }
}

async function restoreBackup() {
  if (!importedPath || !importedPreview) return
  const recordCount = Number(importedPreview.totalRecords)
  const fullState = Boolean(importedPreview.fullState)
  const skippedWarning = fullState
    ? 'This is a full-state restore. It replaces the supported application data with the selected snapshot, including account status, and removes records created after that snapshot.'
    : 'This is a date-scoped restore. It recovers records captured for the selected period, restores backed-up account statuses, and preserves records outside that period.'
  const zeroWarnings = importedPreview.zeroRecordWarnings || []
  const missingWarnings = importedPreview.missingTableWarnings || []
  const restoreWarnings = []
  if (!importedPreview.hasAuthIdentitySnapshot) {
    restoreWarnings.push('This older backup has no Auth identity snapshot; full-state replacement is unavailable, and accounts require their original Supabase Auth identities.')
  }
  if (zeroWarnings.length) {
    restoreWarnings.push(`This backup contains zero ${zeroWarnings.join(', ')} records; those records cannot be recovered from this file.`)
  }
  if (missingWarnings.length) {
    restoreWarnings.push(`This backup omits ${missingWarnings.join(', ')}; those records cannot be recovered from this file.`)
  }
  const emptyWarning = restoreWarnings.length ? `\n\n${restoreWarnings.join('\n')}` : ''
  if (!window.confirm(
    `Restore ${recordCount.toLocaleString()} record(s) from the selected backup?\n\n` +
    `${skippedWarning}\n\n` +
    'A foreign-key or validation failure rolls back the database transaction.' +
    `${emptyWarning}\n\nConfirm to restore.`,
  )) return

  const button = document.getElementById('restoreBackupBtn')
  const previewButton = document.getElementById('previewBackupBtn')
  if (button) {
    button.disabled = true
    button.textContent = 'Restoring…'
  }
  if (previewButton) previewButton.disabled = true
  const resultsElement = document.getElementById('restoreResults')
  if (resultsElement) {
    resultsElement.classList.add('hidden')
    resultsElement.textContent = ''
  }
  let restoreCommitted = false
  let restoreCleanupWarning = ''
  try {
    const result = await invokeBackup('restore', { path: importedPath, confirmed: true })
    restoreCommitted = true
    restoreCleanupWarning = result.cleanupWarning || ''
    const authStatusWarning = result.authStatusWarning || ''
    const tableResults = importedPreview.tables.map(table => {
      const counts = result.results?.[table.name]
      const requested = Number(counts?.requested)
      const restored = Number(counts?.restored)
      if (!counts || ![requested, restored].every(Number.isSafeInteger) ||
          requested < 0 || restored < 0 ||
          requested !== Number(table.records) || (fullState && restored !== requested) || restored > requested) {
        return null
      }
      return {
        name: table.name,
        requested,
        restored,
      }
    })
    if (tableResults.some(table => !table)) {
      if (!result.cleanupWarning) {
        importedPath = ''
        clearPreview()
        document.getElementById('restoreBackupFile').value = ''
      } else {
        importedPreview = null
        document.getElementById('restoreBackupBtn').disabled = true
        document.getElementById('discardRestoreFileBtn')?.classList.remove('hidden')
      }
      setText('restoreResults', 'Per-table restore counts could not be verified.')
      resultsElement?.classList.remove('hidden')
      const warnings = [result.cleanupWarning, authStatusWarning].filter(Boolean).join(' ')
      const message = `The database restore reported success, but its per-table counts could not be verified. Do not retry until you verify the restored data. ${warnings}`
      restoreReport.metadata = [
        ...(restoreReport.metadata || []).filter(([label]) => label !== 'Status'),
        ['Status', 'Restore succeeded; per-table counts need verification'],
      ]
      setText('restoreActionMessage', message)
      showToast('Restore results need verification', message, 'warning')
      return
    }
    const totalRestored = tableResults.reduce((total, table) => total + table.restored, 0)
    restoreReport = {
      title: 'EASPO Restore Report',
      metadata: [
        ['Backup created', formatDate(importedPreview.createdAt)],
        ['Date filters', formatRange(importedPreview.dateFrom, importedPreview.dateTo)],
        ['Status', 'Completed successfully'],
        ['Totals', `Requested ${recordCount}; restored ${totalRestored}`],
      ],
      headers: ['Dataset', 'Requested', 'Restored'],
      rows: tableResults.map(table => [table.name, table.requested, table.restored]),
    }
    const resultText = [
      'Per-table restore results:',
      ...tableResults.map(table =>
        `${table.name}: requested ${table.requested}; restored ${table.restored}`,
      ),
      `Total: requested ${recordCount}; restored ${totalRestored}`,
    ].join('\n')
    setText('restoreResults', resultText)
    resultsElement?.classList.remove('hidden')
    if (result.cleanupWarning) {
      importedPreview = null
      document.getElementById('restoreBackupBtn').disabled = true
      document.getElementById('discardRestoreFileBtn')?.classList.remove('hidden')
      const warnings = [result.cleanupWarning, authStatusWarning].filter(Boolean).join(' ')
      setText('restoreActionMessage', `Restore completed successfully. ${warnings}`)
      showToast('Restore completed with warnings', warnings, 'warning')
      return
    }
    importedPath = ''
    clearPreview()
    document.getElementById('restoreBackupFile').value = ''
    setText('restoreResults', resultText)
    resultsElement?.classList.remove('hidden')
    const summary = fullState
      ? `Restore succeeded: all ${totalRestored} requested records were restored from the selected snapshot.`
      : `Date-scoped restore succeeded: ${totalRestored} missing record(s) were recovered; existing records were preserved.`
    setText('restoreActionMessage', `${summary} ${result.warning || ''} ${authStatusWarning}`)
    if (authStatusWarning) {
      showToast('Restore completed with an account warning', authStatusWarning, 'warning')
    } else {
      showToast('Restore complete', summary, 'success')
    }
  } catch (error) {
    if (restoreCommitted && restoreReport) {
      restoreReport.metadata = [
        ...(restoreReport.metadata || []).filter(([label]) => label !== 'Status'),
        ['Status', 'Restore succeeded; final status needs verification'],
      ]
    }
    let message
    if (restoreCommitted) {
      if (restoreCleanupWarning) {
        importedPreview = null
        document.getElementById('restoreBackupBtn').disabled = true
        document.getElementById('discardRestoreFileBtn')?.classList.remove('hidden')
      } else {
        importedPath = ''
        clearPreview()
        document.getElementById('restoreBackupFile').value = ''
      }
      message = `The database restore reported success, but final status could not be confirmed. Do not retry until you verify the restored data. ${error.message || ''} ${restoreCleanupWarning}`
    } else {
      message = `Restore failed: ${error.message || 'The operation did not complete.'} No complete success is reported. Database constraint failures roll back all restore changes.`
    }
    setText('restoreActionMessage', message)
    showToast(restoreCommitted ? 'Restore results need verification' : 'Restore failed', message, restoreCommitted ? 'warning' : 'error')
  } finally {
    if (previewButton) previewButton.disabled = false
    if (button) {
      button.disabled = !importedPath || !importedPreview
      button.textContent = 'Restore Backup'
    }
  }
}

async function downloadBackup(id) {
  try {
    const result = await invokeBackup('download', { id })
    window.location.assign(result.downloadUrl)
  } catch (error) {
    showToast('Download failed', error.message || 'The backup file could not be downloaded.', 'error')
  }
}

async function deleteBackup(id) {
  if (!window.confirm('Delete this stored backup file and its history record? This cannot be undone.')) return
  try {
    await invokeBackup('delete', { id })
    showToast('Backup deleted', 'The stored backup file and history record were deleted.', 'success')
    await loadBackupHistory()
  } catch (error) {
    showToast('Delete failed', error.message || 'The backup file could not be deleted.', 'error')
  }
}

function renderHistory(runs) {
  const body = document.getElementById('backupHistoryBody')
  if (!body) return
  const latest = runs.find(run => run.backup_type === 'data_export' && run.status === 'verified')
  setText('backupHistorySummary', latest
    ? `Most recent selective backup: ${formatDate(latest.completed_at)}`
    : 'No selective data backup has been completed yet.')
  setText('backupLastRun', latest ? formatDate(latest.completed_at) : 'No selective backup yet')

  if (!runs.length) {
    body.innerHTML = '<tr><td colspan="6">No backup history is available.</td></tr>'
    return
  }

  body.innerHTML = runs.map(run => {
    const isDataBackup = run.backup_type === 'data_export'
    const tables = isDataBackup
      ? (run.included_tables || []).map(name => escapeHtml(name.replace(/_/g, ' '))).join(', ') || '—'
      : 'Full PostgreSQL dump (legacy pipeline)'
    const range = isDataBackup ? formatRange(run.date_from, run.date_to) : '—'
    const status = isDataBackup ? run.status : `${run.status} · legacy dump`
    const actions = isDataBackup && run.status === 'verified'
      ? `<div class="system-backup-restore-actions">
          <button class="btn btn-secondary backup-report-pdf-btn" type="button" data-backup-id="${escapeHtml(run.id)}">Download PDF</button>
          <button class="btn btn-secondary backup-report-excel-btn" type="button" data-backup-id="${escapeHtml(run.id)}">Download Excel</button>
          <button class="btn btn-secondary backup-download-btn" type="button" data-backup-id="${escapeHtml(run.id)}">Download backup</button>
          <button class="btn btn-secondary backup-delete-btn" type="button" data-backup-id="${escapeHtml(run.id)}">Delete</button>
        </div>`
      : '—'
    return `<tr>
      <td>${escapeHtml(formatDate(run.started_at))}</td>
      <td>${escapeHtml(range)}</td>
      <td>${tables}</td>
      <td>${run.size_bytes ? `${escapeHtml((Number(run.size_bytes) / (1024 * 1024)).toFixed(2))} MiB` : '—'}</td>
      <td><span class="health-pill" data-status="${escapeHtml(run.status)}">${escapeHtml(status)}</span></td>
      <td>${actions}</td>
    </tr>`
  }).join('')

  body.querySelectorAll('.backup-report-pdf-btn').forEach(button => {
    button.addEventListener('click', () => exportBackupReport(button, 'pdf', runs))
  })
  body.querySelectorAll('.backup-report-excel-btn').forEach(button => {
    button.addEventListener('click', () => exportBackupReport(button, 'excel', runs))
  })
  body.querySelectorAll('.backup-download-btn').forEach(button => {
    button.addEventListener('click', () => downloadBackup(button.dataset.backupId))
  })
  body.querySelectorAll('.backup-delete-btn').forEach(button => {
    button.addEventListener('click', () => deleteBackup(button.dataset.backupId))
  })
}

export async function loadBackupHistory() {
  const body = document.getElementById('backupHistoryBody')
  if (!body) return
  body.innerHTML = '<tr><td colspan="6">Loading backup history…</td></tr>'
  try {
    const { data, error } = await supabase.from('system_backup_runs')
      .select('id,backup_type,started_at,completed_at,verified_at,status,object_key,size_bytes,included_tables,date_from,date_to')
      .order('started_at', { ascending: false })
      .limit(100)
    if (error) throw error
    renderHistory(data || [])
  } catch (error) {
    setText('backupHistorySummary', 'Backup history is unavailable.')
    body.innerHTML = `<tr><td colspan="6">${escapeHtml(error.message || 'Backup history could not be loaded.')}</td></tr>`
    setText('backupLastRun', 'Unavailable')
  }
}

export function initBackupRecovery() {
  if (handlersInitialized) return
  handlersInitialized = true
  document.getElementById('refreshBackupsBtn')?.addEventListener('click', loadBackupHistory)
  document.getElementById('restoreExportPdfBtn')?.addEventListener('click', () => downloadReport(restoreReport, 'pdf'))
  document.getElementById('restoreExportExcelBtn')?.addEventListener('click', () => downloadReport(restoreReport, 'excel'))
  document.getElementById('backupNowBtn')?.addEventListener('click', createBackup)
  document.getElementById('previewBackupBtn')?.addEventListener('click', previewBackup)
  document.getElementById('restoreBackupBtn')?.addEventListener('click', restoreBackup)
  document.getElementById('discardRestoreFileBtn')?.addEventListener('click', async () => {
    if (await discardImport()) {
      document.getElementById('restoreBackupFile').value = ''
      setText('restoreActionMessage', 'Temporary uploaded file removed.')
    }
  })
  document.getElementById('restoreBackupFile')?.addEventListener('change', async () => {
    clearPreview()
    clearRestoreResults()
    restoreReport = null
    document.getElementById('restoreExportActions')?.classList.add('hidden')
    const removed = await discardImport()
    if (!removed) document.getElementById('discardRestoreFileBtn')?.classList.remove('hidden')
    else setText('restoreActionMessage', '')
  })
  document.getElementById('backupAllDatasets')?.addEventListener('change', event => {
    document.querySelectorAll('[data-backup-dataset]').forEach(input => {
      input.checked = event.currentTarget.checked
    })
  })
  document.querySelectorAll('[data-backup-dataset]').forEach(input => {
    input.addEventListener('change', () => {
      const allChecked = selectedDatasets().length === DATASETS.length
      document.getElementById('backupAllDatasets').checked = allChecked
    })
  })
}
