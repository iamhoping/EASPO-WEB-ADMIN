# Attendance Auto-Absent System - Deployment Checklist

## Phase 1: Database Setup
- [ ] Run migration to add columns to attendance table:
  - [ ] `schedule_id` (UUID FK to schedules)
  - [ ] `is_late` (BOOLEAN, default FALSE)
  - [ ] `guardian_email_sent` (BOOLEAN, default FALSE)
- [ ] Create indexes for performance:
  - [ ] `attendance_schedule_id_idx`
  - [ ] `attendance_auto_absent_idx`
- [ ] Verify all students have `guardian_email` in profiles table
- [ ] Test database connection and permissions

## Phase 2: Code Deployment
- [ ] Deploy Supabase Edge Function: `supabase/functions/auto-mark-absent/index.ts`
  ```bash
  supabase functions deploy auto-mark-absent
  ```
- [ ] Update `server.js` with auto-absent scheduler (ALREADY DONE)
- [ ] Update `public/js/modules/scanner-attendance.js` with late scan handling (ALREADY DONE)
- [ ] Install dependencies if needed: `npm install`

## Phase 3: Email Service Setup (Choose One)
- [ ] **Option A: SendGrid**
  - [ ] Create SendGrid account at https://sendgrid.com
  - [ ] Get API key
  - [ ] Set environment variable: `SENDGRID_API_KEY=your-key`
  - [ ] Set environment variable: `EMAIL_FROM=noreply@school.edu`
  - [ ] Update `sendGuardianEmail` function in edge function with SendGrid code
  - [ ] Test email sending

- [ ] **Option B: Brevo**
  - [ ] Create Brevo account at https://www.brevo.com
  - [ ] Get API key
  - [ ] Set environment variable: `BREVO_API_KEY=your-key`
  - [ ] Set environment variable: `EMAIL_FROM=noreply@school.edu`
  - [ ] Update `sendGuardianEmail` function in edge function with Brevo code
  - [ ] Test email sending

- [ ] **Option C: Mailgun**
  - [ ] Create Mailgun account
  - [ ] Get API key and domain
  - [ ] Set environment variables:
    - [ ] `MAILGUN_API_KEY=your-key`
    - [ ] `MAILGUN_DOMAIN=your-domain`
  - [ ] Update `sendGuardianEmail` function in edge function with Mailgun code
  - [ ] Test email sending

- [ ] **Option D: Supabase Email (if available)**
  - [ ] Check Supabase plan for email support
  - [ ] Configure email settings in Supabase dashboard

## Phase 4: Environment Variables
- [ ] Set `SUPABASE_URL` (if not already set)
- [ ] Set `SUPABASE_SERVICE_ROLE_KEY` (if not already set)
- [ ] Set email service credentials (SendGrid, Brevo, or Mailgun)
- [ ] Verify `.env` file is in `.gitignore`

## Phase 5: Testing
### Test 1: Database and Auto-Absent Logic
- [ ] Create a test schedule for today starting 2 hours ago
- [ ] Create a test student without attendance for that schedule
- [ ] Call endpoint: `POST /api/trigger-auto-absent`
- [ ] Verify student is marked absent in database
- [ ] Verify `guardian_email_sent` flag is set

### Test 2: Scanner UI Updates
- [ ] Scan a new student (should show "Attendance Recorded Successfully")
- [ ] Scan same student again (should show "Already Scanned")
- [ ] Mark a student absent using auto-absent
- [ ] Scan the absent student (should show "Late Arrival Recorded")
- [ ] Verify database shows:
  - [ ] `status = 'present'`
  - [ ] `is_late = true`
  - [ ] `time_in` = actual scan time (not schedule time)

### Test 3: Email Notifications
- [ ] Create schedule for 1 hour ago
- [ ] Create student with valid guardian email
- [ ] Run auto-absent check
- [ ] Verify email is received by guardian
- [ ] Check email content:
  - [ ] Student name
  - [ ] Absence date and time
  - [ ] Schedule time
  - [ ] Late scan possibility message

### Test 4: Race Conditions
- [ ] Scan a student at 59:59 before grace period ends
- [ ] Verify: student marked present, NOT absent
- [ ] Run auto-absent at 60:01 after grace period
- [ ] Verify: student remains present, email NOT sent
- [ ] Scan student after marked absent
- [ ] Verify: status updates to present, is_late = true

### Test 5: Edge Cases
- [ ] Student without guardian email (should not send email, log warning)
- [ ] Schedule with no students assigned (should skip)
- [ ] Student without section_id (should handle gracefully)
- [ ] Multiple schedules for same student (should check all)
- [ ] Inactive or cancelled schedules (should skip)

## Phase 6: Production Deployment
- [ ] Deploy to production server
- [ ] Set production environment variables
- [ ] Verify auto-absent scheduler is running (check logs)
- [ ] Monitor for 24 hours to catch any issues
- [ ] Set up log aggregation/monitoring

## Phase 7: Documentation & Training
- [ ] Review ATTENDANCE_AUTO_ABSENT_SETUP.md
- [ ] Train admin staff on system behavior
- [ ] Document any custom configurations
- [ ] Create user guide for teachers/admins
- [ ] Add to system documentation

## Rollback Plan
If issues arise:
- [ ] Stop server: Stop the scheduler in server.js
- [ ] Restore attendance records from backup
- [ ] Disable auto-absent by commenting out scheduler start
- [ ] Investigate issue in development
- [ ] Test thoroughly before re-deployment

## Files Modified/Created
✅ Created:
- [ ] `supabase/functions/auto-mark-absent/index.ts` - Edge function for auto-absent
- [ ] `supabase/migrations/20240101000000_add_auto_absent_columns.sql` - Database migration
- [ ] `ATTENDANCE_AUTO_ABSENT_SETUP.md` - Setup guide
- [ ] `EMAIL_SERVICE_EXAMPLES.ts` - Email integration examples
- [ ] `DEPLOYMENT_CHECKLIST.md` - This file

✅ Modified:
- [ ] `server.js` - Added auto-absent scheduler
- [ ] `public/js/modules/scanner-attendance.js` - Updated late scan handling

## Performance Metrics to Monitor
- Auto-absent check duration (should be < 30 seconds)
- Number of students processed per run
- Email delivery success rate
- Database query performance
- Server memory/CPU during checks

## Support & Troubleshooting
See ATTENDANCE_AUTO_ABSENT_SETUP.md for:
- Troubleshooting guide
- Common issues and solutions
- Logging information
- Performance considerations

## Sign-Off
- [ ] QA Lead: _____________________ Date: _______
- [ ] DevOps Lead: _____________________ Date: _______
- [ ] Product Owner: _____________________ Date: _______
