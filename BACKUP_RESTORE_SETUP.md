# EASPO Backup and Restore Setup

The Backup & Restore page creates encrypted, selective data backups and stores them in a private bucket in the existing Supabase project. Administrators can download a local copy. No paid or external backup service is required, but Supabase free-plan quotas still apply.

## Deploy

1. Reconcile the Supabase migration history before applying SQL. In the linked EASPO project, the current CLI migration list shows only the two `20240101...` migrations as applied; the migrations from `20260924...` onward are pending. A normal `supabase db push --linked` would try to apply all of them, not just this feature. Do **not** push them blindly to the live project. Compare each pending migration with the deployed schema in staging and determine which changes are already present. Only after verifying that a migration's SQL effects are already present should its history entry be repaired. Replace the example timestamp below with the exact 14-digit version from `supabase migration list --linked`; do not type the angle brackets. **This command only marks the version as applied in migration history; it does not run the migration SQL.**

   ```powershell
   supabase migration repair --linked --status applied 20260924000000
   ```

   Run that example only if you have verified that migration `20260924000000` has already been applied to the database. Apply genuinely missing earlier migrations through the tested deployment workflow. Confirm `supabase db push --linked --dry-run` lists only migrations you have reviewed before any push. Then apply `supabase/migrations/20261020000003_selective_backup_restore.sql`. It adds the selective-backup metadata, a private `easpo-backups` bucket with a 10 MiB per-file limit, and the transactional restore RPC. The bucket grants no direct access to browser users; the Edge Function uses the server-side service role.
2. Generate a unique 32-byte encryption key in PowerShell and save a protected offline copy. Do not commit the key or place it in frontend code:

   ```powershell
   $bytes = New-Object byte[] 32
   $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
   $rng.GetBytes($bytes)
   $key = [Convert]::ToBase64String($bytes)
   supabase secrets set "EASPO_BACKUP_ENCRYPTION_KEY=$key"
   $rng.Dispose()
   Remove-Variable bytes, key, rng
   ```

   The key is required to preview and restore files. If it is lost or rotated, older files cannot be decrypted. Preserve the old key securely before rotating it.
3. Deploy the function: `supabase functions deploy selective-backup`. Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to the function; do not add either value to frontend configuration. The function independently verifies the caller's Supabase session and requires an active `WEB_ADMIN` profile.
4. Deploy the web application. The existing Supabase URL and publishable key in the frontend are used only for the authenticated session and signed file upload; they do not grant access to the private bucket.

## Safe sample-data test

Do this in a separate test/staging Supabase project with the same migrations, using synthetic names and contact details only:

1. Create a test Web Admin and synthetic student, teacher, and parent Auth accounts, then create related sections, subjects, schedules, grades, and attendance records using the normal EASPO flows.
2. Open **Backup & Restore**, select the synthetic records' date range and tables, create the backup, and confirm it downloads. Check its metadata and record counts in history.
3. Upload the downloaded `.easpobackup` file and validate the preview. Cancel once to test cleanup, then preview again and restore after confirming. Verify inserted records and foreign-key relationships in the staging application.
4. Restore the same file a second time. Verify existing records are skipped and not changed. Also try a renamed non-backup file and a modified backup file; validation should reject both without changing database rows.
5. Test history download and deletion using only the synthetic backup. Confirm deletion removes both the storage object and its history row.

Do not test by deleting or restoring real production student records. Backups are restored by inserting only: existing unique/conflicting records are ignored, not overwritten. Profile records can only be inserted when their corresponding Supabase Auth user already exists. Auth passwords, sessions, and schema/migration state are not part of these data backups; this is not a complete Supabase project or point-in-time database backup.

## Limits and coverage

- Supported data: student, teacher, and parent profiles; sections; subjects; schedules; grades; attendance; and system settings. Date filters use `attendance_date` for attendance, `created_at` for sections, subjects, schedules, and grades, and `updated_at` for system settings. The deployed `profiles` table has no creation/update date columns, so selected profile roles are included in full regardless of the date filter. An incompatible schema produces a visible backup error.
- Each file is capped at 10 MiB and 50,000 total rows to bound Edge Function memory use. Supabase free storage, Edge Function, database, and bandwidth quotas remain in force. Backups share the project's storage quota with existing uploads; delete old backups or download and remove them to free space. These limits are not a substitute for monitoring current Supabase plan quotas.
- Backup contents are AES-256-GCM encrypted server-side before storage and when downloaded. Private bucket access is only through short-lived links issued after Web Admin authorization. Anyone with a downloaded file and access to the configured encryption key can read its contents.
- Restore inserts parent datasets before dependent records within a single database transaction. If a foreign key or table constraint fails, the restore transaction makes no partial changes. Date-filtered backups can omit dependencies that were created outside the selected range; include the related sections, subjects, and profiles or use a broader range for a complete restore.
- `system_settings` contains application settings, not credentials. Auth data, files from other buckets, activity logs, and the optional legacy GitHub Actions PostgreSQL dump are not included in selective backups. GitHub source backups do not contain Supabase database records.
