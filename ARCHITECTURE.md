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
