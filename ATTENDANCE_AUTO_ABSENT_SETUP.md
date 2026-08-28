# Attendance Auto-Absent System - Implementation Guide

## Overview
This implementation adds automatic absent marking for students who don't scan within a 1-hour grace period of their scheduled class time, along with guardian email notifications.

## Features Implemented

### 1. **Auto-Absent After 1-Hour Grace Period**
- Backend scheduler runs every 5 minutes to check schedules
- Students without scans within 1 hour of schedule start time are marked absent
- Automatic process runs on server, not in browser

### 2. **Late Scan Handling**
- Students marked absent can still scan later
- System updates the absent record to present with actual arrival time
- Marked with `is_late = true` for reporting purposes

### 3. **Guardian Email Notifications**
- Email sent when student is automatically marked absent
- Uses `guardian_email` column from profiles table
- Email includes:
  - Student name
  - Absence date
  - Scheduled class time
  - Message about late scan possibility

### 4. **Race Condition Protection**
- Database checks prevent marking present students as absent
- Scheduler gracefully handles concurrent operations
- Guardian email sent flag prevents duplicate emails

## Setup Instructions

### Step 1: Database Migrations

Run the migration to add required columns to the attendance table:

```sql
-- Run this in your Supabase SQL editor

ALTER TABLE attendance
ADD COLUMN IF NOT EXISTS schedule_id UUID REFERENCES schedules(id);

ALTER TABLE attendance
ADD COLUMN IF NOT EXISTS is_late BOOLEAN DEFAULT FALSE;

ALTER TABLE attendance
ADD COLUMN IF NOT EXISTS guardian_email_sent BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS attendance_schedule_id_idx ON attendance(schedule_id);

CREATE INDEX IF NOT EXISTS attendance_auto_absent_idx 
ON attendance(attendance_date, status, guardian_email_sent);
```

Or use the migration file:
```bash
supabase migration up
```

### Step 2: Deploy Supabase Edge Function

The auto-mark-absent edge function is located at `supabase/functions/auto-mark-absent/index.ts`

Deploy it using:
```bash
supabase functions deploy auto-mark-absent
```

### Step 3: Environment Variables

Add these to your environment (`.env` or deployment config):

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
PORT=3000
```

### Step 4: Update Scanner UI

The scanner UI now shows different messages for different scenarios:

- **"Attendance Recorded Successfully"** - First time scan (present)
- **"Late Arrival Recorded"** - Student scans after grace period (absent → present, marked late)
- **"Already Scanned"** - Student tries to scan again when already present
- **"No Schedule Today"** - Student doesn't have a schedule for today

### Step 5: Email Configuration (IMPORTANT)

**Current Status**: The auto-absent function logs emails to console. For production, you need to integrate with an email service.

**Options:**
1. **SendGrid** (Recommended)
   - Sign up at https://sendgrid.com
   - Get API key
   - Update the `sendGuardianEmail` function in `supabase/functions/auto-mark-absent/index.ts`

2. **Brevo (Sendinblue)**
   - Sign up at https://www.brevo.com
   - Get API key
   - Update email function

3. **Supabase Email** (if available in your plan)
   - Use Supabase's native email support

**Example SendGrid Integration:**

Replace the `sendGuardianEmail` function in the edge function with:

```typescript
async function sendGuardianEmail(
  guardianEmail: string,
  studentName: string,
  scheduleTime: string,
  attendanceDate: string
): Promise<boolean> {
  try {
    const sendgridApiKey = Deno.env.get('SENDGRID_API_KEY')
    if (!sendgridApiKey) {
      console.log('[EMAIL] SendGrid API key not configured')
      return false
    }

    const subject = 'Student Attendance Notification'
    const htmlBody = `
      <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <p>Good day,</p>
          <p>This is to inform you that your child, <strong>${studentName}</strong>, was marked <strong>Absent</strong> today, <strong>${attendanceDate}</strong>, for their scheduled class at <strong>${scheduleTime}</strong>.</p>
          <p>If your child arrives later and scans their student ID/QR code, their attendance will be updated to <strong>Present</strong> and their actual arrival time will be recorded.</p>
          <p>Thank you.</p>
        </body>
      </html>
    `

    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${sendgridApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: guardianEmail }] }],
        from: { email: 'noreply@yourschool.edu' },
        subject: subject,
        content: [{ type: 'text/html', value: htmlBody }],
      }),
    })

    if (!response.ok) {
      console.error(`[EMAIL] SendGrid error: ${response.status}`)
      return false
    }

    console.log(`[EMAIL] Sent to ${guardianEmail}`)
    return true
  } catch (error) {
    console.error(`[EMAIL] Error: ${error}`)
    return false
  }
}
```

## Testing the System

### Test Auto-Absent Logic

1. Create a test schedule for today that started 1 hour ago
2. Create a student without an attendance record for that schedule
3. Call the endpoint:
   ```bash
   curl -X POST http://localhost:3000/api/trigger-auto-absent
   ```
4. Check the database - student should be marked absent

### Test Late Scan

1. Run the auto-absent check (creates absent record)
2. Scan the student's ID at the scanner
3. Verify:
   - Attendance status changes to "Present"
   - `time_in` shows actual scan time
   - `is_late` is set to true
   - Scanner shows "Late Arrival Recorded"

### Test Email Notification

1. Configure email service (SendGrid, Brevo, etc.)
2. Add guardian email to student profile
3. Run auto-absent check
4. Verify email is received by guardian

## Database Schema Changes

### attendance table additions:

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| schedule_id | UUID (FK) | NULL | Links to the schedule this attendance is for |
| is_late | BOOLEAN | FALSE | Indicates student arrived after grace period |
| guardian_email_sent | BOOLEAN | FALSE | Tracks if notification email was sent |

## Monitoring & Logging

The system logs important events:

- `[AUTO-ABSENT] Processing for [date]` - Start of processing
- `[AUTO-ABSENT] Found X schedules` - Number of schedules checked
- `[AUTO-ABSENT] Processing schedule X - grace period ended` - Each schedule
- `[AUTO-ABSENT] Marked student X as absent` - Absence recorded
- `[EMAIL] Sent to guardian@email.com` - Email sent
- `[SCANNER] Late scan detected` - Late attendance update

Monitor logs in:
- Server console (for backend logs)
- Browser console (for scanner UI logs)
- Supabase function logs

## API Endpoints

### POST /api/trigger-auto-absent

Manually trigger the auto-absent checking process.

**Response:**
```json
{
  "message": "Auto-absent processing complete",
  "date": "2024-01-15",
  "processedCount": 5,
  "emailsSent": 4
}
```

## Important Notes

1. **Grace Period**: Fixed at 1 hour from schedule start time. Modify `const graceEndTimeMinutes = startTimeMinutes + 60` in the edge function to change.

2. **Schedule Matching**: The system checks:
   - Schedule date or day of week
   - Student assignment (direct or via section)
   - Schedule status (must be active)

3. **Email Safety**: Emails are only sent once per absence record (tracked by `guardian_email_sent` flag).

4. **Time Zone**: Ensure your server and database use the same time zone (preferably UTC).

5. **Performance**: The auto-absent check runs every 5 minutes. Adjust the interval in `server.js` if needed.

## Troubleshooting

### Students Not Being Marked Absent

Check:
- [ ] Schedule exists for today with correct date/day
- [ ] Schedule status is 'active' (not cancelled or inactive)
- [ ] Student is assigned to schedule (via student_id or section_id)
- [ ] Grace period has actually ended
- [ ] No attendance record exists for that student/schedule/date

### Emails Not Sending

Check:
- [ ] Email service is configured (SendGrid, Brevo, etc.)
- [ ] API key is set in environment variables
- [ ] Guardian email exists in student profile
- [ ] Email sender address is verified in email service

### Scanner Issues

Check:
- [ ] Student has a schedule for today
- [ ] Scanner is looking up student ID correctly
- [ ] Database has the new `schedule_id`, `is_late`, `guardian_email_sent` columns
- [ ] Browser console shows no errors

## Performance Considerations

- Auto-absent check runs every 5 minutes by default
- Each run fetches all active schedules and checks their students
- Indexes on `attendance` table improve query performance
- Consider increasing interval if processing takes > 30 seconds

## Security Notes

- Edge function uses SUPABASE_SERVICE_ROLE_KEY (requires authentication)
- Email addresses are only used for notifications
- No sensitive data logged to console in production
- Verify email service has proper authentication
