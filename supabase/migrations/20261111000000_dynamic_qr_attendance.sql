BEGIN;

CREATE TABLE IF NOT EXISTS public.student_qr_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  session_code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  revoked BOOLEAN NOT NULL DEFAULT FALSE
);

UPDATE public.student_qr_sessions
SET created_at = clock_timestamp()
WHERE created_at IS NULL;

UPDATE public.student_qr_sessions
SET revoked = FALSE
WHERE revoked IS NULL;

ALTER TABLE public.student_qr_sessions
  ALTER COLUMN created_at SET DEFAULT clock_timestamp(),
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN revoked SET DEFAULT FALSE,
  ALTER COLUMN revoked SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_active_session_code
  ON public.student_qr_sessions (session_code)
  WHERE used_at IS NULL AND revoked = FALSE;

CREATE INDEX IF NOT EXISTS student_qr_sessions_code_created_idx
  ON public.student_qr_sessions (session_code, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_qr_student_lookup
  ON public.student_qr_sessions (student_id);

ALTER TABLE public.student_qr_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.student_qr_sessions FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS "Students can view their own sessions" ON public.student_qr_sessions;

DROP FUNCTION IF EXISTS public.generate_student_qr_session();
DROP FUNCTION IF EXISTS public.process_attendance_scan(TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.generate_student_qr_session()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
SET row_security = off
AS $$
DECLARE
  v_student_id UUID := auth.uid();
  v_student public.profiles%ROWTYPE;
  v_bytes BYTEA;
  v_alphabet CONSTANT TEXT := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_code TEXT;
  v_session public.student_qr_sessions%ROWTYPE;
  v_index INTEGER;
  v_byte_index INTEGER;
  v_value INTEGER;
BEGIN
  IF v_student_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_student
  FROM public.profiles
  WHERE id = v_student_id
  FOR UPDATE;

  IF NOT FOUND OR v_student.role <> 'STUDENT'
      OR LOWER(COALESCE(v_student.status, 'active')) IN ('inactive', 'archived')
      OR v_student.section_id IS NULL THEN
    RAISE EXCEPTION 'Only eligible student accounts can generate QR codes.'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.student_qr_sessions
  SET revoked = TRUE
  WHERE student_id = v_student_id
    AND used_at IS NULL
    AND revoked = FALSE;

  LOOP
    v_bytes := DECODE(SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', '') FROM 1 FOR 10), 'hex');
    v_code := '';
    FOR v_index IN 0..5 LOOP
      v_byte_index := (v_index * 5) / 8;
      v_value := (
        ((GET_BYTE(v_bytes, v_byte_index) << 8) | GET_BYTE(v_bytes, v_byte_index + 1))
        >> (11 - ((v_index * 5) % 8))
      ) & 31;
      v_code := v_code || SUBSTRING(v_alphabet FROM (v_value + 1) FOR 1);
    END LOOP;

    INSERT INTO public.student_qr_sessions (student_id, session_code, expires_at)
    VALUES (v_student_id, v_code, clock_timestamp() + INTERVAL '30 seconds')
    ON CONFLICT (session_code)
      WHERE used_at IS NULL AND revoked = FALSE
      DO NOTHING
    RETURNING * INTO v_session;

    EXIT WHEN FOUND;
  END LOOP;

  RETURN jsonb_build_object(
    'session_code', v_session.session_code,
    'created_at', v_session.created_at,
    'expires_at', v_session.expires_at
  );
END;
$$;

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
  v_time_in TIME;
  v_status TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.profiles scanner
    WHERE scanner.id = auth.uid()
      AND scanner.role = 'SCANNER'
      AND LOWER(COALESCE(scanner.status, 'active')) NOT IN ('inactive', 'archived')
  ) THEN
    RAISE EXCEPTION 'An active scanner account is required.'
      USING ERRCODE = '42501';
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

  v_time_in := v_local_now::TIME;
  v_is_late := CASE
    WHEN v_existing_attendance THEN TRUE
    ELSE v_time_in > v_schedule.start_time + MAKE_INTERVAL(mins => v_late_grace_minutes)
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

ALTER FUNCTION public.generate_student_qr_session() OWNER TO postgres;
ALTER FUNCTION public.generate_student_qr_session() SET search_path = pg_catalog, public, auth, pg_temp;
ALTER FUNCTION public.generate_student_qr_session() SET row_security = off;
ALTER FUNCTION public.process_dynamic_qr_attendance(TEXT) OWNER TO postgres;
ALTER FUNCTION public.process_dynamic_qr_attendance(TEXT) SET search_path = pg_catalog, public, auth, pg_temp;
ALTER FUNCTION public.process_dynamic_qr_attendance(TEXT) SET row_security = off;

REVOKE ALL ON FUNCTION public.generate_student_qr_session() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.process_dynamic_qr_attendance(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_student_qr_session() TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_dynamic_qr_attendance(TEXT) TO authenticated;

COMMIT;
