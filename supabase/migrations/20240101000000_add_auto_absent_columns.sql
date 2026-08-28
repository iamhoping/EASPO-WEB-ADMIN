-- Migration: Add auto-absent support columns to attendance table
-- This migration adds the following columns:
-- - schedule_id: Links to the schedules table for better tracking
-- - is_late: Boolean flag to indicate if student arrived late (after 1-hour grace period)
-- - guardian_email_sent: Boolean flag to track if guardian email notification has been sent

-- Determine schedules.id's type at migration time rather than assuming UUID.
DO $$
DECLARE schedule_id_type text;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod) INTO schedule_id_type
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'schedules' AND a.attname = 'id'
    AND a.attnum > 0 AND NOT a.attisdropped;
  IF schedule_id_type IS NULL THEN
    RAISE EXCEPTION 'public.schedules.id was not found; attendance migration stopped.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'attendance' AND column_name = 'schedule_id'
  ) THEN
    EXECUTE format('ALTER TABLE public.attendance ADD COLUMN schedule_id %s REFERENCES public.schedules(id)', schedule_id_type);
  END IF;
END $$;

-- Add is_late column if it doesn't exist
ALTER TABLE public.attendance
ADD COLUMN IF NOT EXISTS is_late BOOLEAN NOT NULL DEFAULT FALSE;

-- Add guardian_email_sent column if it doesn't exist
ALTER TABLE public.attendance
ADD COLUMN IF NOT EXISTS guardian_email_sent BOOLEAN NOT NULL DEFAULT FALSE;

-- Create an index on schedule_id for better query performance
CREATE UNIQUE INDEX IF NOT EXISTS attendance_student_schedule_date_key
ON public.attendance(student_id, schedule_id, attendance_date)
WHERE schedule_id IS NOT NULL;

-- Create a composite index for efficient queries during auto-absent processing
CREATE INDEX IF NOT EXISTS attendance_auto_absent_idx
ON public.attendance(attendance_date, status, guardian_email_sent)
WHERE schedule_id IS NOT NULL;
