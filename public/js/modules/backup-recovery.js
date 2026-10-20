import { supabase } from '../services/supabaseClient.js'
import { showToast } from '../ui/toast.js'

const BUCKET = 'easpo-backups'
const MAX_FILE_BYTES = 10 * 1024 * 1024
const DATASETS = [
  ['students', 'Students'],
  ['teachers', 'Teachers'],
  ['parents', 'Parents'],
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
    if (zeroWarnings.length) {
      warningLines.push(`WARNING: This backup has zero ${zeroWarnings.join(', ')} records. These records cannot be recovered from this backup.`)
    }
    if (missingWarnings.length) {
      warningLines.push(`WARNING: This backup does not include ${missingWarnings.join(', ')}. Those records cannot be recovered from this backup.`)
    }
    const warning = warningLines.length ? `\n\n${warningLines.join('\n')}` : ''
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
  const skippedWarning = 'Existing conflicting records will be skipped, not overwritten. Records that are absent from the backup will not be recovered.'
  const zeroWarnings = importedPreview.zeroRecordWarnings || []
  const missingWarnings = importedPreview.missingTableWarnings || []
  const restoreWarnings = []
  if (zeroWarnings.length) {
    restoreWarnings.push(`This backup contains zero ${zeroWarnings.join(', ')} records; those records cannot be recovered from this file.`)
  }
  if (missingWarnings.length) {
    restoreWarnings.push(`This backup omits ${missingWarnings.join(', ')}; those records cannot be recovered from this file.`)
  }
  const emptyWarning = restoreWarnings.length ? `\n\n${restoreWarnings.join('\n')}` : ''
  if (!window.confirm(
    `Restore ${recordCount.toLocaleString()} record(s) from the selected backup?\n\n` +
    `${skippedWarning}\n\nNew records are inserted in dependency order. ` +
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
    const tableResults = importedPreview.tables.map(table => {
      const counts = result.results?.[table.name]
      const requested = Number(counts?.requested)
      const inserted = Number(counts?.inserted)
      const skipped = Number(counts?.skipped)
      if (!counts || ![requested, inserted, skipped].every(Number.isSafeInteger) ||
          requested < 0 || inserted < 0 || skipped < 0 ||
          requested !== Number(table.records) || inserted + skipped !== requested) {
        return null
      }
      return {
        name: table.name,
        requested,
        inserted,
        skipped,
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
      const cleanup = result.cleanupWarning ? ` ${result.cleanupWarning}` : ''
      const message = `The database restore reported success, but its per-table counts could not be verified. Do not retry until you verify the restored data.${cleanup}`
      setText('restoreActionMessage', message)
      showToast('Restore results need verification', message, 'warning')
      return
    }
    const totalSkipped = tableResults.reduce((total, table) => total + table.skipped, 0)
    const totalInserted = tableResults.reduce((total, table) => total + table.inserted, 0)
    const resultText = [
      'Per-table restore results:',
      ...tableResults.map(table =>
        `${table.name}: requested ${table.requested}; inserted ${table.inserted}; skipped ${table.skipped}`,
      ),
      `Total: requested ${recordCount}; inserted ${totalInserted}; skipped ${totalSkipped}`,
    ].join('\n')
    setText('restoreResults', resultText)
    resultsElement?.classList.remove('hidden')
    if (result.cleanupWarning) {
      importedPreview = null
      document.getElementById('restoreBackupBtn').disabled = true
      document.getElementById('discardRestoreFileBtn')?.classList.remove('hidden')
      const status = totalSkipped ? 'Restore completed with skipped records.' : 'Restore completed successfully.'
      setText('restoreActionMessage', `${status} ${result.cleanupWarning}`)
      showToast(totalSkipped ? 'Restore completed with skipped records' : 'Restore completed', result.cleanupWarning, 'warning')
      return
    }
    importedPath = ''
    clearPreview()
    document.getElementById('restoreBackupFile').value = ''
    setText('restoreResults', resultText)
    resultsElement?.classList.remove('hidden')
    const summary = totalSkipped
      ? `Restore completed with skipped records: ${totalInserted} inserted and ${totalSkipped} skipped. Existing conflicts were preserved.`
      : `Restore succeeded: all ${totalInserted} requested records were inserted.`
    setText('restoreActionMessage', `${summary} ${result.warning || ''}`)
    showToast(totalSkipped ? 'Restore completed with skipped records' : 'Restore complete', summary, totalSkipped ? 'warning' : 'success')
  } catch (error) {
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
      ? `<button class="btn btn-secondary backup-download-btn" type="button" data-backup-id="${escapeHtml(run.id)}">Download</button>
         <button class="btn btn-secondary backup-delete-btn" type="button" data-backup-id="${escapeHtml(run.id)}">Delete</button>`
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
