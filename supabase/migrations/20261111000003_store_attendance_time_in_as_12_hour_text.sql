BEGIN;

ALTER TABLE public.attendance
  ALTER COLUMN time_in TYPE TEXT
  USING CASE
    WHEN time_in IS NULL THEN NULL
    ELSE TO_CHAR(time_in::TIME, 'FMHH12:MI AM')
  END;

CREATE OR REPLACE FUNCTION public.process_dynamic_qr_attendance(p_session_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
SET row_security = off
AS $$
DECLARE
  v_now TIMESTAMPTZ;
  v_local_now TIMESTAMP;
  v_today DATE;
  v_day TEXT;
  v_session public.student_qr_sessions%ROWTYPE;
  v_student public.profiles%ROWTYPE;
  v_schedule public.schedules%ROWTYPE;
  v_attendance public.attendance%ROWTYPE;
  v_section_name TEXT;
  v_subject_name TEXT;
  v_late_grace_minutes INTEGER := 0;
  v_existing_attendance BOOLEAN := FALSE;
  v_is_late BOOLEAN;
  v_time_in TEXT;
  v_status TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.profiles scanner
    WHERE scanner.id = auth.uid()
      AND scanner.role = 'SCANNER'
      AND LOWER(COALESCE(scanner.status, 'active')) NOT IN ('inactive', 'archived')
  ) THEN
    RAISE EXCEPTION 'An active scanner account is required.' USING ERRCODE = '42501';
  END IF;

  IF p_session_code IS NULL OR p_session_code !~ '^[A-Z0-9]{6}$' THEN
    RETURN jsonb_build_object('status', 'INVALID_QR');
  END IF;

  SELECT * INTO v_session
  FROM public.student_qr_sessions
  WHERE session_code = p_session_code
  ORDER BY CASE WHEN used_at IS NULL AND revoked = FALSE THEN 0 ELSE 1 END,
           created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND OR v_session.revoked THEN
    RETURN jsonb_build_object('status', 'INVALID_QR');
  END IF;
  v_now := clock_timestamp();
  IF v_session.expires_at <= v_now THEN
    RETURN jsonb_build_object('status', 'EXPIRED_QR');
  END IF;
  IF v_session.used_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'ALREADY_USED');
  END IF;

  SELECT * INTO v_student
  FROM public.profiles
  WHERE id = v_session.student_id;

  IF NOT FOUND OR v_student.role <> 'STUDENT'
      OR LOWER(COALESCE(v_student.status, 'active')) IN ('inactive', 'archived')
      OR v_student.section_id IS NULL THEN
    RETURN jsonb_build_object('status', 'STUDENT_NOT_ELIGIBLE');
  END IF;

  v_now := clock_timestamp();
  IF v_session.expires_at <= v_now THEN
    RETURN jsonb_build_object('status', 'EXPIRED_QR');
  END IF;

  SELECT name INTO v_section_name
  FROM public.sections
  WHERE id = v_student.section_id;

  IF v_section_name IS NULL THEN
    RETURN jsonb_build_object('status', 'STUDENT_NOT_ELIGIBLE');
  END IF;

  v_local_now := v_now AT TIME ZONE 'Asia/Manila';
  v_today := v_local_now::DATE;
  v_day := UPPER(BTRIM(TO_CHAR(v_local_now, 'FMDay')));

  SELECT * INTO v_schedule
  FROM public.schedules
  WHERE section_id = v_student.section_id
    AND LEFT(UPPER(BTRIM(day)), 3) = LEFT(v_day, 3)
  ORDER BY start_time, id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'NO_ACTIVE_SCHEDULE');
  END IF;

  SELECT * INTO v_attendance
  FROM public.attendance
  WHERE student_id = v_student.id
    AND schedule_id = v_schedule.id
    AND attendance_date = v_today::TEXT
  FOR UPDATE;

  IF FOUND AND LOWER(COALESCE(v_attendance.status, '')) <> 'absent' THEN
    RETURN jsonb_build_object('status', 'DUPLICATE_ATTENDANCE');
  END IF;
  v_existing_attendance := FOUND;

  SELECT NULLIF(BTRIM(value::TEXT, '"'), '')::INTEGER
  INTO v_late_grace_minutes
  FROM public.system_settings
  WHERE key = 'late_grace_minutes';
  v_late_grace_minutes := COALESCE(v_late_grace_minutes, 0);

  IF v_late_grace_minutes < 0 OR v_late_grace_minutes > 240 THEN
    RAISE EXCEPTION 'The configured late-arrival grace period is invalid.';
  END IF;

  v_time_in := TO_CHAR(v_local_now, 'FMHH12:MI AM');
  v_is_late := CASE
    WHEN v_existing_attendance THEN TRUE
    ELSE v_local_now::TIME > v_schedule.start_time + MAKE_INTERVAL(mins => v_late_grace_minutes)
  END;
  v_status := 'present';
  v_subject_name := COALESCE(
    to_jsonb(v_schedule)->>'subject_name',
    to_jsonb(v_schedule)->>'subject',
    '—'
  );

  v_now := clock_timestamp();
  IF v_session.expires_at <= v_now THEN
    RETURN jsonb_build_object('status', 'EXPIRED_QR');
  END IF;

  BEGIN
    IF v_attendance.id IS NOT NULL THEN
      UPDATE public.attendance
      SET status = v_status,
          time_in = v_time_in,
          is_late = v_is_late,
          teacher_id = v_schedule.teacher_id,
          subject_id = v_schedule.subject_id,
          subject = v_subject_name
      WHERE id = v_attendance.id;
    ELSE
      INSERT INTO public.attendance (
        student_id, teacher_id, attendance_date, time_in, status,
        schedule_id, subject_id, subject, section_id, is_late,
        guardian_email_sent
      )
      VALUES (
        v_student.id, v_schedule.teacher_id, v_today::TEXT, v_time_in, v_status,
        v_schedule.id, v_schedule.subject_id, v_subject_name, v_student.section_id,
        v_is_late, FALSE
      );
    END IF;
  EXCEPTION
    WHEN unique_violation THEN
      RETURN jsonb_build_object('status', 'DUPLICATE_ATTENDANCE');
  END;

  UPDATE public.student_qr_sessions
  SET used_at = clock_timestamp()
  WHERE id = v_session.id
    AND used_at IS NULL;

  RETURN jsonb_build_object(
    'status', 'ATTENDANCE_RECORDED',
    'attendance_status', CASE WHEN v_is_late THEN 'late' ELSE v_status END,
    'student', jsonb_build_object(
      'name', v_student.name,
      'student_id', v_student.student_id,
      'grade_level', v_student.grade_level,
      'section_name', v_section_name
    ),
    'subject_name', v_subject_name,
    'time_in', v_time_in
  );
END;
$$;

ALTER FUNCTION public.process_dynamic_qr_attendance(TEXT) OWNER TO postgres;
ALTER FUNCTION public.process_dynamic_qr_attendance(TEXT) SET search_path = pg_catalog, public, auth, pg_temp;
ALTER FUNCTION public.process_dynamic_qr_attendance(TEXT) SET row_security = off;
REVOKE ALL ON FUNCTION public.process_dynamic_qr_attendance(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_dynamic_qr_attendance(TEXT) TO authenticated;

COMMIT;
