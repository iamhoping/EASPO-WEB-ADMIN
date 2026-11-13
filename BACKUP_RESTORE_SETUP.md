# EASPO Backup and Restore Setup

The Backup & Restore page offers selective encrypted backups in Supabase Storage and full PostgreSQL SQL backups through a private Render worker.

## Full PostgreSQL SQL backup and restore

EASPO runs on Supabase/PostgreSQL. It does not have a MySQL `users.is_deleted` table: account state is stored in `public.profiles.status` (`archived` or `active`). Archived Account restore updates the profile back to active and removes the Supabase Auth ban.

The browser's selective encrypted `.easpobackup` workflow covers supported EASPO datasets, not every database table; selective restore is additive and skips conflicts. It can reactivate an archived student, teacher, or parent if the original Auth login still exists. It does not include Web Admin, School Admin, or Scanner profiles and cannot recreate a permanently deleted Auth login.

The full `.sql` workflow dumps database schemas and rows accessible to the configured PostgreSQL connection. Use it for whole-database recovery, including archived rows and Auth rows when accessible. It does not include Supabase project settings, Edge Function secrets, API keys, or the actual bytes of Supabase Storage objects.

### Web backup and restore (Render)

The full SQL controls call the separate Render worker in `restore-worker/`. Database credentials and PostgreSQL tools stay on Render; the browser sends only the signed-in Web Admin's access token and selected SQL file. The worker verifies the token with Supabase, permits only an active `WEB_ADMIN`, checks that the database URL matches the Supabase project, requires the exact destructive confirmation on restore, and uses `psql` with stop-on-error and a single transaction. It signs web-generated SQL files with a server-only HMAC key and rejects files that are unsigned or changed. Only one full-database operation runs at a time.

Set up the worker before using the full SQL web controls:

1. Push the repository to the branch connected to Render. In Render, create a **Blueprint** from this repository and select that branch. Render reads `render.yaml` and creates the `easpo-full-restore` Docker web service. Its image installs `pg_dump` and `psql`.
2. Set these service environment variables in Render:
   - `SUPABASE_URL`: the exact Supabase project URL used by this EASPO deployment.
   - `SUPABASE_SERVICE_ROLE_KEY`: the matching service-role key. Keep it only in Render's secret environment; never put it in frontend code or share it.
   - `SUPABASE_DB_URL`: the PostgreSQL connection URL for the same project, with SSL enabled. Prefer the Supabase session pooler URL if Render cannot connect to the direct database host. This is a database password and must remain a Render secret.
   - `BACKUP_SIGNING_SECRET`: a random secret of at least 32 characters. Keep a secure offline copy and do not rotate it unless you are willing to make previously downloaded web backups unusable in the web restore flow.
   - `ALLOWED_ORIGINS`: the Render blueprint defaults to `*` as requested, allowing browser requests from any origin. This does not bypass the required active-Web-Admin session or server-side checks. To restrict browser origins later, replace `*` with exact HTTPS origins (comma-separated for production and staging).
3. Wait for the Render health check at `/health` to pass. The frontend defaults to `https://easpo-full-restore.onrender.com`. If Render assigns another service URL, change `FULL_SQL_WORKER_URL` in `public/js/modules/backup-recovery.js` to the exact HTTPS URL, then redeploy the frontend.
4. Deploy the frontend. The selective `.easpobackup` controls continue using Supabase directly; full SQL backup and restore use Render.

Generate `BACKUP_SIGNING_SECRET` in PowerShell, then copy its output directly into Render's secret setting and keep a protected offline copy:

```powershell
$bytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$secret = [Convert]::ToBase64String($bytes)
$secret
$rng.Dispose()
Remove-Variable bytes, secret, rng
```

The web **Download Full SQL Backup** button downloads a uniquely named, signed `.sql` file to the administrator's device. The web restore accepts these signed worker-generated files only; edited files and unsigned local CLI dumps must be restored with the local CLI workflow instead. Render removes its temporary copy after download; it does not retain server-side backup history or enforce seven-file retention. Keep the downloaded SQL files securely and use the local tools below for automatic retention of the latest seven. The worker's default SQL size limit is 100 MiB (`RESTORE_MAX_BYTES`); consider Render's request limits and available temporary disk space before increasing it. Free Render services can sleep between requests, so the first request can take longer.

The web **Restore Full Database** control accepts dated EASPO SQL files and requires the exact text `Are you sure? This will replace all current data with the backup data.` plus a second confirmation. The restore replaces current database contents, so users and data created after the backup can disappear. After completion, sign in with an account present in the backup and verify the restored data. Test first against a staging Supabase project with synthetic accounts. If the worker loses contact during an accepted job, inspect the database before retrying.

### Local SQL backup and restore

The local tools remain available as a fallback and retain the latest seven files in the git-ignored `backups/` folder. Install PostgreSQL command-line tools compatible with the database server (`pg_dump` and `psql`) and make sure both commands are available in PowerShell. From the repository root, run:

```powershell
npm run backup:database
```

The script asks for `SUPABASE_DB_URL` with hidden input unless that environment variable is already set. Use the project's PostgreSQL connection URL from Supabase Database settings; the URL must include its host, database, username, and password. The script uses SSL, makes a plain `.sql` dump without filtering schemas, tables, account roles, or status, and saves it in `backups/` using names such as `easp_backup_2026-11-13_09-00-AM.sql`. It never overwrites a same-minute backup and removes older generated backups only after a new dump succeeds, keeping the latest seven. The `backups/` folder is git-ignored because dumps contain sensitive student and account data.

To replace the current database contents from a generated SQL backup, run:

```powershell
npm run restore:database -- backups\easp_backup_2026-11-13_09-00-AM.sql
```

The script prints the requested confirmation sentence and proceeds only when the full sentence is entered exactly. It runs `psql` with stop-on-error and a single transaction. The dump uses `--clean --if-exists`, so objects and rows represented by the backup are dropped and recreated. Archived profiles are ordinary rows and are included. A full database dump may include Supabase Auth database rows needed to restore a permanently deleted login; verify this with a full staging restore before relying on it. Restoring managed Supabase schemas can affect sign-in and storage, so do not try it against production until staging has been tested and the target project/version confirmed.

The existing GitHub Actions full-database backup (`scripts/backup_database.py`) is separate: it creates an encrypted PostgreSQL archive in S3-compatible storage, with its own remote retention policy. The local `.sql` rotation does not delete or change those remote backups.

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
3. Deploy the functions: `supabase functions deploy selective-backup` and `supabase functions deploy manage-archived-account`. The selective restore uses the account-archive function to reactivate backed-up profiles that are currently archived. Supabase supplies the server-side URL and keys; do not add the service-role key to frontend configuration. The functions independently verify the caller's Supabase session and active administrator permissions.
4. Deploy the web application. The existing Supabase URL and publishable key in the frontend are used only for the authenticated session and signed file upload; they do not grant access to the private bucket.

Each completed selective backup history entry has its own PDF and Excel download containing its backed-up records, as well as metadata; the Excel workbook has a sheet for each dataset. The PDF and every workbook sheet include the configured school logo, name, and address. Restore results can also be downloaded as PDF or Excel reports. Record exports are unencrypted and may contain personal information, so store them securely. They do not replace the encrypted `.easpobackup` file used to restore data.

## Safe sample-data test

Do this in a separate test/staging Supabase project with the same migrations, using synthetic names and contact details only:

1. Create a test Web Admin and synthetic student, teacher, and parent Auth accounts, then create related sections, subjects, schedules, grades, and attendance records using the normal EASPO flows.
2. Open **Backup & Restore**, select the synthetic records' date range and tables, create the backup, and confirm it downloads. Check its metadata and record counts in history.
3. Upload the downloaded `.easpobackup` file and validate the preview. Cancel once to test cleanup, then preview again and restore after confirming. Verify inserted records and foreign-key relationships in the staging application.
4. Archive one synthetic account that was active in the backup. Restore the file and verify that account is reactivated and can sign in. Restore the same file a second time and verify existing non-account records are skipped and not changed. Also try a renamed non-backup file and a modified backup file; validation should reject both without changing database rows.
5. Test the per-backup PDF and Excel downloads using only the synthetic backup. Verify that every selected dataset and its records appear in the exports, then test the encrypted file download and deletion. Confirm deletion removes both the storage object and its history row.

Do not test by deleting or restoring real production student records. Backups are restored by inserting only: existing unique/conflicting records are ignored, not overwritten. Profile records can only be inserted when their corresponding Supabase Auth user already exists. Auth passwords, sessions, and schema/migration state are not part of these data backups, so a permanently deleted account cannot be recreated from a backup. Archive accounts instead when they may need to be restored; archived accounts retain their Auth identity and can be restored from Archived Accounts. This is not a complete Supabase project or point-in-time database backup.

## Limits and coverage

- Supported data: student, teacher, and parent profiles; sections; subjects; schedules; grades; attendance; and system settings. Date filters use `attendance_date` for attendance, `created_at` for sections, subjects, schedules, and grades, and `updated_at` for system settings. The deployed `profiles` table has no creation/update date columns, so selected profile roles are included in full regardless of the date filter. An incompatible schema produces a visible backup error.
- Each file is capped at 10 MiB and 50,000 total rows to bound Edge Function memory use. Supabase free storage, Edge Function, database, and bandwidth quotas remain in force. Backups share the project's storage quota with existing uploads; delete old backups or download and remove them to free space. These limits are not a substitute for monitoring current Supabase plan quotas.
- Backup contents are AES-256-GCM encrypted server-side before storage and when downloaded. Private bucket access is only through short-lived links issued after Web Admin authorization. Anyone with a downloaded file and access to the configured encryption key can read its contents.
- Restore inserts parent datasets before dependent records within a single database transaction. If a foreign key or table constraint fails, the restore transaction makes no partial changes. Date-filtered backups can omit dependencies that were created outside the selected range; include the related sections, subjects, and profiles or use a broader range for a complete restore.
- `system_settings` contains application settings, not credentials. Auth data, files from other buckets, activity logs, and the optional legacy GitHub Actions PostgreSQL dump are not included in selective backups. GitHub source backups do not contain Supabase database records.
