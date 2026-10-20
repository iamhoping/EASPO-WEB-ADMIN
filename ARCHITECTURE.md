# Attendance Auto-Absent System - Technical Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     EASPO Attendance System                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────────┐         ┌──────────────────────┐          │
│  │   Scanner UI     │         │   Backend Server     │          │
│  │  (Browser)       │◄────────│   (Node.js/Express)  │          │
│  │                  │         │                      │          │
│  │ • Scan Input     │         │ • Serves static      │          │
│  │ • Student Lookup │         │ • Auto-absent        │          │
│  │ • Attendance     │         │   scheduler          │          │
│  │   Creation       │         │ • Triggers edge fn   │          │
│  └──────────────────┘         └──────────┬───────────┘          │
│           │                              │                       │
│           └──────────────┬───────────────┘                       │
│                          ▼                                       │
│                   ┌─────────────────┐                           │
│                   │  Supabase API   │                           │
│                   │  (REST/RealTime)│                           │
│                   └────────┬────────┘                           │
│                            │                                     │
│         ┌──────────────────┼──────────────────┐                 │
│         ▼                  ▼                  ▼                 │
│  ┌─────────────┐  ┌──────────────────┐  ┌──────────────┐      │
│  │  Database   │  │  Edge Functions  │  │ Auth Service │      │
│  │  (PostgreSQL)│  │ • auto-mark-abs │  │              │      │
│  │             │  │   ent            │  │              │      │
│  │ Tables:     │  │ • Processes      │  │              │      │
│  │ • profiles  │  │   schedules      │  │              │      │
│  │ • attendance│  │ • Marks absent   │  │              │      │
│  │ • schedules │  │ • Sends email    │  │              │      │
│  │ • sections  │  └──────────────────┘  └──────────────┘      │
│  └─────────────┘                                                │
│                                                                   │
│  ┌──────────────────────────────────────────────────────┐       │
│  │         Email Service (SendGrid/Brevo/etc)          │       │
│  │  Sends guardian notifications via Edge Function      │       │
│  └──────────────────────────────────────────────────────┘       │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

## Component Architecture

### 1. Frontend Scanner Module
**File**: `public/js/modules/scanner-attendance.js`

```
Scanner Input
     │
     ▼
Parse & Normalize
     │
     ▼
Student Lookup
     │
     ▼
Check Schedule (today)
     │
     ├──► No Schedule ──► Show Error & Exit
     │
     ▼
Check Existing Attendance
     │
     ├──► Present ──► Show "Already Scanned" & Exit
     │
     ├──► Absent ──► UPDATE to Present (Late Scan)
     │               ├► Set time_in = now
     │               ├► Set is_late = true
     │               └► Show "Late Arrival"
     │
     └──► None ──► INSERT new Present record
                  └► Show "Success"
```

**Key Functions**:
- `recordScan(rawValue)` - Main scan processing
- `findTodaySchedule(student, date, day)` - Schedule validation
- `showResult()` - Success UI
- `showErrorResult()` - Error UI

### 2. Backend Scheduler
**File**: `server.js`

```
Server Start
     │
     ▼
Initialize Express
     │
     ▼
Start Auto-Absent Scheduler
     │
     ▼
┌─────────────────────────────┐
│  Every 5 Minutes:           │
│  POST /api/trigger-auto-abs │
│  Call Edge Function         │
└─────────────────────────────┘
     │
     ▼
Logs Results
     │
     ▼
Sleep 5 minutes
     │
     ▼ (Repeat)
```

**Scheduler Configuration**:
- Interval: 5 minutes (adjustable)
- Trigger: Automatic, runs even if no users active
- Method: HTTP POST to `/api/trigger-auto-absent`
- Execution: Non-blocking, parallel to main server

### 3. Edge Function (Auto-Absent Logic)
**File**: `supabase/functions/auto-mark-absent/index.ts`

```
Edge Function Triggered
     │
     ▼
Get Current Time
     │
     ▼
Fetch All Active Schedules
     │
     ▼
For Each Schedule:
     │
     ├─► Check if Schedule is Today
     │   └─► Skip if not today
     │
     ├─► Get Start Time
     │   ├─► Calculate Grace Period End (start + 60 min)
     │   └─► Skip if grace period not ended
     │
     ├─► Find Students Assigned to Schedule
     │   ├─► Direct: schedule.student_id
     │   └─► Section: schedule.section_id
     │
     └─► For Each Student:
         │
         ├─► Check Existing Attendance
         │   │
         │   ├─► If Present
         │   │   └─► Skip (don't mark absent)
         │   │
         │   ├─► If Absent + Email Sent
         │   │   └─► Skip (already processed)
         │   │
         │   ├─► If Absent + No Email
         │   │   └─► Send Email Now
         │   │
         │   └─► If None
         │       └─► Create Absent Record
         │
         ├─► Set Status = 'absent'
         │
         ├─► Set guardian_email_sent = false
         │   (or true after email)
         │
         └─► Send Guardian Email
             ├─► Get guardian_email from profiles
             ├─► Format notification message
             ├─► Send via email service
             └─► Update guardian_email_sent = true
```

**Key Functions**:
- `sendGuardianEmail()` - Email notification
- `timeStringToMinutes()` - Time parsing
- `formatLocalDate()` - Date formatting
- Main serve loop - Schedule processing

### 4. Database Schema

#### attendance table (additions)

```sql
CREATE TABLE attendance (
  id UUID PRIMARY KEY,
  student_id UUID NOT NULL REFERENCES profiles(id),
  section_id UUID REFERENCES sections(id),
  schedule_id UUID REFERENCES schedules(id),  -- NEW
  attendance_date DATE NOT NULL,
  status TEXT NOT NULL, -- 'present', 'absent', 'late', 'excused'
  time_in TIME,
  time_out TIME,
  subject TEXT,
  is_late BOOLEAN DEFAULT FALSE,  -- NEW
  guardian_email_sent BOOLEAN DEFAULT FALSE,  -- NEW
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

-- Indexes for performance
CREATE INDEX attendance_schedule_id_idx ON attendance(schedule_id);
CREATE INDEX attendance_auto_absent_idx ON attendance(attendance_date, status, guardian_email_sent);
```

#### profiles table (required for email)

```sql
-- Must have guardian_email column
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS guardian_email TEXT;
```

#### schedules table (assumed structure)

```sql
CREATE TABLE schedules (
  id UUID PRIMARY KEY,
  student_id UUID REFERENCES profiles(id),
  section_id UUID REFERENCES sections(id),
  schedule_date DATE,
  day_of_week TEXT,
  start_time TIME,
  end_time TIME,
  subject_name TEXT,
  status TEXT DEFAULT 'active',
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT now()
);
```

## Data Flow Diagrams

### Flow 1: Normal Attendance (No Late)
```
Student Scans QR
     │
     ▼
[Scanner] recordScan()
     │
     ├─► Lookup Student
     ├─► Check Schedule (Today)
     ├─► Check Existing Attendance
     │   └─► None Found
     ├─► INSERT attendance { status: 'present', time_in: now() }
     └─► UI: "Success"

[Database]
attendance: { student_id, status: 'present', time_in: HH:MM:SS, is_late: false, ... }
```

### Flow 2: Late Scan After Auto-Absent
```
[Scheduler] Auto-Absent Check @ 10:00 AM
     │
     ├─► Schedule started 9:00 AM (60 min ago)
     ├─► Find students without attendance
     └─► UPDATE attendance { status: 'absent', ... }

[Database]
attendance: { student_id, status: 'absent', guardian_email_sent: false, ... }
     │
     ▼ (30 minutes later)

Student Scans QR @ 10:30 AM
     │
     ▼
[Scanner] recordScan()
     │
     ├─► Lookup Student
     ├─► Check Schedule (Today)
     ├─► Check Existing Attendance
     │   └─► Found: status = 'absent'
     ├─► UPDATE attendance { status: 'present', time_in: 10:30, is_late: true }
     └─► UI: "Late Arrival"

[Database]
attendance: { student_id, status: 'present', time_in: 10:30, is_late: true, ... }
```

### Flow 3: Guardian Email Notification
```
[Scheduler] @ 10:00 AM
     │
     └─► Student marked Absent
     │
     ├─► Get student.guardian_email
     ├─► Build Email:
     │   ├─ To: guardian_email
     │   ├─ Subject: "Student Attendance Notification"
     │   └─ Body: Absence details + late scan info
     │
     ├─► Call Email Service (SendGrid/Brevo/etc)
     │   └─► Email Sent ✓
     │
     ├─► UPDATE attendance { guardian_email_sent: true }
     │
     └─► Log "[EMAIL] Sent to guardian@email.com"

[Email Service]
     │
     └─► Guardian receives email notification
```

## Time Calculation Logic

### Grace Period Calculation
```
Schedule Start Time: 09:00
Grace Period: 1 hour
Grace End Time: 10:00

If Current Time >= 10:00:
  AND Student has no attendance record:
    → Mark as Absent
```

### Late Detection
```
Schedule Time: 09:00
Student Scanned: 10:17

Is Scan After Grace Period?
  10:17 >= 10:00 ✓
  
Was Student Marked Absent?
  status = 'absent' ✓
  
Result:
  Set is_late = true
  Update status = 'present'
```

## Error Handling & Edge Cases

### Case 1: Student Not Found
```
Scan → Lookup → NOT FOUND → Show Error → Exit
```

### Case 2: No Schedule Today
```
Scan → Lookup → Check Schedule → None → Show "No Schedule" → Exit
```

### Case 3: Already Present
```
Scan → Check Existing → Found (Present) → Show "Already Scanned" → Exit
```

### Case 4: Email Send Fails
```
Auto-Absent → Lookup Email → Send Failed → Log Error → Continue
(Attendance still marked absent, email retry on next check)
```

### Case 5: Student Without Guardian Email
```
Auto-Absent → Lookup Email → NULL → Log Warning → Skip Email → Continue
(Attendance marked absent, no email sent, no error)
```

### Case 6: Race Condition (Almost Simultaneous)
```
Scenario 1:
  09:59 - Scan → Present ✓
  10:00 - Auto-Absent Check → Find Present → Skip ✓

Scenario 2:
  10:00:01 - Auto-Absent → Mark Absent
  10:00:02 - Scan → Found Absent → Update to Present ✓
```

## Performance Considerations

### Database Query Optimization
```
Indexed Columns:
- attendance(attendance_date, status, guardian_email_sent)
- attendance(schedule_id)
- profiles(student_id, role)
- schedules(active, status)

Query Performance:
- Get active schedules: ~10-50ms
- Find students by section: ~5-20ms per section
- Check attendance: ~2-5ms per student
- Overall: ~500ms - 2s per run (depends on schedule count)
```

### Scalability
- **100 schedules**: ~5-10 seconds
- **1000 students**: ~2-5 seconds per batch
- **Concurrent scanners**: Non-blocking, independent

### Memory Usage
- Edge function: ~10-50 MB per execution
- Scanner module: ~5-10 MB per browser
- Scheduler: Minimal overhead

## Security Considerations

1. **Edge Function Security**
   - Uses service_role_key (server-side only)
   - No client-side key exposure
   - Database row-level security can be applied

2. **Email Security**
   - Guardian email only sent to profile owner
   - No email in logs (sanitized in production)
   - Rate limiting recommended for email service

3. **Data Privacy**
   - Student data not exposed in API responses
   - Email service configured separately from code
   - Guardian emails encrypted in transit

## Monitoring & Observability

### Logs to Monitor
```
[AUTO-ABSENT] Processing for 2024-01-15 at 10:00:00
[AUTO-ABSENT] Found 25 schedules
[AUTO-ABSENT] Processing schedule abc123 - grace period ended
[AUTO-ABSENT] Marked student xyz789 as absent
[EMAIL] Sent to guardian@email.com via SendGrid
[AUTO-ABSENT] Processed: 15, Emails: 12
```

### Metrics to Track
- Schedules processed per run
- Students marked absent
- Emails sent successfully
- Email failures
- Execution time

### Alerts to Set Up
- Scheduler fails to trigger
- Edge function errors
- High email failure rate (>10%)
- Query performance degradation

## Future Enhancements

1. **Late Notification**: Send email when student scans late
2. **Cron Expression**: Support custom schedule patterns
3. **Grace Period Config**: Make configurable per schedule
4. **Bulk Operations**: Process multiple days at once
5. **Analytics**: Dashboard for absence trends
6. **SMS Notifications**: Add SMS option for guardians
7. **Calendar Integration**: Sync with calendar apps
8. **Machine Learning**: Predict likely absences

## School Administration Role

`SCHOOL_ADMIN` signs in through Supabase Auth and is routed to the role-aware
admin dashboard. The dashboard reuses the existing student, teacher, parent,
subject, section, schedule, attendance, grade, and report modules. It hides
Web Admin user management and security settings.

The `20261017000000_school_admin_role_and_policies.sql` migration adds the
role checks, scoped RLS policies, account-status enforcement, and database
validation for student/section and schedule assignments. School Admins can
manage student, teacher, and parent profiles, subjects, sections, and
schedules; attendance and grade records remain read-only. Scanner attendance
and Teacher grade-entry policies remain in place.

The `20261017000001_web_admin_activity_and_system_admin.sql` migration adds
immutable activity logs, operational health telemetry, non-secret system
settings, and a protected backup-history table. Activity triggers exclude
authentication credentials and passwords from snapshots. Web Admin-only
operations are enforced by RLS and authenticated Edge Functions, not just by
the dashboard navigation. The scheduled absence process consumes its configured
absence grace period and email-enabled setting; scanners can read only the
non-secret late-arrival grace setting, which defaults to zero minutes to
preserve existing scan behavior.

The `20261017000002_web_admin_auth_login_history.sql` migration adds a
Web-Admin-only function to read recent sign-in events from
`auth.audit_log_entries`. Enable **Write audit logs to the database** in
Supabase Dashboard → Authentication → Audit Logs for this source to return
records. This database source reports completed sign-ins; failed sign-in
attempts require a separate trusted Auth log export/Log Explorer integration
and are not synthesized by the application.

The `20261017000004_school_branding_storage.sql` migration creates the public-read,
Web-Admin-write `school-assets` bucket and the narrow
`get_public_school_branding()` RPC. Apply it with `supabase db push` before
using School Name and the School Logo upload in System Settings. The uploaded
PNG/JPG/WebP logo (maximum 2 MiB) and configured school name are stored and
loaded on the login, Web Admin, School Admin, Teacher, and Scanner pages. No
anonymous or School Admin upload permissions are granted.

The `20261018000000_account_archiving.sql` migration adds archive metadata and
prevents archived accounts from authenticating, being assigned to sections or
new schedules, or recording scanner attendance. Archiving preserves the profile
and academic history, stores the student's prior section ID as text (so it
supports existing numeric as well as UUID section IDs), and clears the student's
active section assignment. The `20261020000000_account_archived_section_text.sql`
migration converts existing archive metadata to that compatible type. The Archived Accounts page
supports confirmation-only archive/restore for students, teachers, and parents.
Student archives receive the default `Graduated` reason; teacher and parent
archives receive `Inactive`. Reasons are retained in account metadata but are
not displayed in the Archived Accounts list. Restored students return without a
section assignment and must be assigned again.

The `20261020000001_student_profile_details.sql` migration enforces uniqueness
for the existing student `student_id` field, which stores and is displayed as
the student's LRN, adds optional gender and date-of-birth fields, and adds
row-scoped student/parent reads for their own or explicitly linked records.
The Student Portal shows permitted personal, attendance, grade, and class data;
parents must be linked to a student to see that child's records. Teacher
student-profile actions continue to use
teacher-scoped profile, attendance, grade, and schedule policies. Apply this
migration before deploying the student/parent portal frontend.

The `20261020000002_school_address_reporting.sql` migration adds a configurable
school address to public branding data for official report headers. Web Admins
can configure it in System Settings; report Print and PDF use the active report's
filtered tables and summaries in a dedicated print layout.

New and edited account names use `Last Name, First Name`. Existing names without
a comma are displayed unchanged because the single stored name field does not
reliably distinguish multi-word surnames, middle names, or suffixes. Convert
those legacy records only after verifying the intended name parts.

Deploy the migrations and Edge Functions:

```bash
supabase db push
supabase functions deploy create-school-account
supabase functions deploy set-school-account-status
supabase functions deploy manage-archived-account
supabase functions deploy change-user-role
supabase functions deploy system-health
supabase functions deploy change-user-password
supabase functions deploy auto-mark-absent
supabase functions deploy record-backup-run
```

Account archiving also requires deploying `manage-archived-account`; deploying
`set-school-account-status` alone does not install the archive/restore endpoint.
Run `supabase db push` first so the archive metadata columns and RLS policies
exist before invoking that function.

Role assignment is available to Web Admins in User Management; the server
rejects self-role changes and School Admin promotion to Web Admin. Account
creation, status changes, password resets, role changes, and health checks
must use their authenticated Edge Functions. Keep the Supabase service-role
key and notification credentials in server-side environment variables only.

System Monitoring checks the dashboard API/database live and shows only
telemetry emitted by instrumented background processes. Authentication login
history is not available unless a trusted Supabase Auth-log integration is
configured. ### Automated off-site database backups

`scripts/backup_database.py` and `.github/workflows/daily-database-backup.yml`
provide a daily encrypted PostgreSQL backup to AWS S3 or another S3-compatible
provider. The workflow runs daily at 02:00 UTC (10:00 Asia/Manila) and can also
be started manually from GitHub Actions. It creates a custom-format
`pg_dump` archive, validates its TOC with `pg_restore --list`, encrypts it with
age before upload, downloads the uploaded object and compares its SHA-256 and
size, and deletes objects older than 30 days under `backups/easpo-db/`. A
history row is marked `verified` only after these checks succeed; this verifies
archive readability and the remote copy, not an end-to-end database restore.

Apply the backup metadata migration after the other system migrations:

```bash
supabase db push
```

Create an age keypair on a trusted operator machine. Save the private key
offline with the recovery procedure; add only the public recipient (the
`age1...` value printed by `age-keygen`) to the GitHub repository secret
`BACKUP_AGE_RECIPIENT`.

Configure these GitHub Actions repository secrets:

| Secret | Purpose |
| --- | --- |
| `SUPABASE_DB_URL` | PostgreSQL connection URI used by `pg_dump`; use an SSL-enabled session-pooler URI if the project requires IPv4/pooler access. |
| `SUPABASE_URL` | Project URL used to record backup-run status. |
| `SUPABASE_ANON_KEY` | Supabase publishable/anon key sent to the backup-history Edge Function. |
| `BACKUP_RUNNER_SECRET` | Random shared secret; configure the same value as a Supabase Edge Function secret and a GitHub Actions secret. |
| `S3_BUCKET` | Private bucket name. |
| `S3_REGION` | S3 region (use the provider's required value, commonly `auto` for Cloudflare R2). |
| `S3_ENDPOINT_URL` | S3-compatible endpoint; leave empty for AWS S3. |
| `S3_ACCESS_KEY_ID` | Bucket-scoped upload/list/download/delete access key. |
| `S3_SECRET_ACCESS_KEY` | Secret half of the bucket-scoped access key. |
| `BACKUP_AGE_RECIPIENT` | Public age encryption recipient; the matching private key stays offline. |

Grant the bucket key only list access to the `backups/easpo-db/` prefix and
object get/put/delete permissions on that prefix. Require TLS and keep the
bucket private. The 30-day cleanup requires delete permission. The job uses
age encryption before upload, so the provider stores only ciphertext.

Generate a long random runner secret, store it as an Edge Function secret, and
add the identical value to GitHub Actions:

```bash
openssl rand -hex 32
supabase secrets set BACKUP_RUNNER_SECRET="<generated-value>"
```

Do not put the service-role key in GitHub. The Edge Function keeps it
server-side and only accepts constrained start/verified/failed history events
authenticated with the runner secret.

Run **Daily encrypted database backup** manually from GitHub Actions to test
setup. A successful run should appear in the Web Admin **Backup & Recovery**
page with status `verified`, object size, and SHA-256. A failed run is recorded
as `failed`; check the action logs for its sanitized error.

For a restore drill, retrieve an encrypted object using operator credentials,
decrypt it offline with the private age key, inspect it using
`pg_restore --list`, and restore it into a separate isolated Supabase project.
Validate representative tables and application behavior there. Never run a
restore drill against production. A successful upload/checksum does not claim
that a restore has been tested.
