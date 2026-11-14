BEGIN;

ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.teacher_owns_attendance_record(
  p_student_id UUID,
  p_schedule_id BIGINT,
  p_section_id TEXT
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL
    AND p_student_id IS NOT NULL
    AND p_schedule_id IS NOT NULL
    AND p_section_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.profiles teacher
      JOIN public.schedules schedule
        ON schedule.teacher_id = teacher.id
      JOIN public.profiles student
        ON student.id = p_student_id
      WHERE teacher.id = auth.uid()
        AND teacher.role = 'TEACHER'
        AND LOWER(COALESCE(teacher.status, 'active')) NOT IN ('inactive', 'archived', 'deleted')
        AND schedule.id = p_schedule_id
        AND schedule.section_id::TEXT = p_section_id
        AND student.role = 'STUDENT'
        AND student.section_id::TEXT = schedule.section_id::TEXT
        AND LOWER(COALESCE(student.status, 'active')) NOT IN ('inactive', 'archived', 'deleted')
    );
$$;

REVOKE ALL ON FUNCTION public.teacher_owns_attendance_record(UUID, BIGINT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.teacher_owns_attendance_record(UUID, BIGINT, TEXT) TO authenticated;

DROP POLICY IF EXISTS "teachers_view_own_attendance" ON public.attendance;
CREATE POLICY "teachers_view_own_attendance"
ON public.attendance FOR SELECT
USING (
  public.teacher_owns_attendance_record(student_id, schedule_id, section_id::TEXT)
);

DROP POLICY IF EXISTS "teachers_manage_own_attendance" ON public.attendance;
CREATE POLICY "teachers_manage_own_attendance"
ON public.attendance FOR INSERT
WITH CHECK (
  teacher_id = auth.uid()
  AND status IN ('present', 'late', 'absent')
  AND public.teacher_owns_attendance_record(student_id, schedule_id, section_id::TEXT)
);

DROP POLICY IF EXISTS "teachers_update_own_attendance" ON public.attendance;
CREATE POLICY "teachers_update_own_attendance"
ON public.attendance FOR UPDATE
USING (
  public.teacher_owns_attendance_record(student_id, schedule_id, section_id::TEXT)
)
WITH CHECK (
  teacher_id = auth.uid()
  AND status IN ('present', 'late', 'absent')
  AND public.teacher_owns_attendance_record(student_id, schedule_id, section_id::TEXT)
);

DROP POLICY IF EXISTS "teachers_delete_own_attendance" ON public.attendance;
DROP POLICY IF EXISTS "teachers_cannot_delete_attendance" ON public.attendance;
CREATE POLICY "teachers_cannot_delete_attendance"
ON public.attendance AS RESTRICTIVE FOR DELETE
USING (NOT public.is_teacher());

CREATE OR REPLACE FUNCTION public.set_teacher_attendance_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  local_now TIMESTAMP;
BEGIN
  IF public.is_teacher() THEN
    local_now := clock_timestamp() AT TIME ZONE 'Asia/Manila';
    NEW.teacher_id := auth.uid();
    NEW.attendance_date := TO_CHAR(local_now, 'YYYY-MM-DD');
    NEW.time_in := CASE
      WHEN LOWER(BTRIM(COALESCE(NEW.status, ''))) = 'absent' THEN NULL
      ELSE TO_CHAR(local_now, 'FMHH12:MI AM')
    END;
  ELSIF public.is_web_admin() THEN
    IF TG_OP = 'INSERT'
       OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.time_in IS DISTINCT FROM OLD.time_in THEN
      local_now := clock_timestamp() AT TIME ZONE 'Asia/Manila';
      NEW.time_in := CASE
        WHEN LOWER(BTRIM(COALESCE(NEW.status, ''))) = 'absent' THEN NULL
        ELSE TO_CHAR(local_now, 'FMHH12:MI AM')
      END;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS attendance_set_teacher_timestamp ON public.attendance;
CREATE TRIGGER attendance_set_teacher_timestamp
BEFORE INSERT OR UPDATE ON public.attendance
FOR EACH ROW
EXECUTE FUNCTION public.set_teacher_attendance_timestamp();

CREATE OR REPLACE FUNCTION public.record_teacher_manual_attendance(
  p_schedule_id BIGINT,
  p_entries JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_teacher_id UUID := auth.uid();
  v_schedule RECORD;
  v_entry JSONB;
  v_student_id UUID;
  v_status TEXT;
  v_local_now TIMESTAMP;
  v_attendance_date TEXT;
  v_time_in TEXT;
  v_recorded_count INTEGER := 0;
  v_duplicate_student_ids JSONB := '[]'::JSONB;
  v_seen_student_ids UUID[] := ARRAY[]::UUID[];
BEGIN
  IF v_teacher_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.profiles teacher
    WHERE teacher.id = v_teacher_id
      AND teacher.role = 'TEACHER'
      AND LOWER(COALESCE(teacher.status, 'active')) NOT IN ('inactive', 'archived', 'deleted')
  ) THEN
    RAISE EXCEPTION 'An active teacher account is required.'
      USING ERRCODE = '42501';
  END IF;

  IF p_schedule_id IS NULL THEN
    RAISE EXCEPTION 'Select one of your assigned schedules.'
      USING ERRCODE = '22023';
  END IF;

  IF p_entries IS NULL
     OR jsonb_typeof(p_entries) <> 'array'
     OR jsonb_array_length(p_entries) = 0 THEN
    RAISE EXCEPTION 'Attendance entries are required.'
      USING ERRCODE = '22023';
  END IF;

  SELECT schedule.*
  INTO v_schedule
  FROM public.schedules schedule
  WHERE schedule.id = p_schedule_id
    AND schedule.teacher_id = v_teacher_id;

  IF NOT FOUND OR v_schedule.section_id IS NULL THEN
    RAISE EXCEPTION 'The selected schedule is not assigned to this teacher.'
      USING ERRCODE = '42501';
  END IF;

  v_local_now := clock_timestamp() AT TIME ZONE 'Asia/Manila';
  v_attendance_date := TO_CHAR(v_local_now, 'YYYY-MM-DD');

  FOR v_entry IN SELECT value FROM jsonb_array_elements(p_entries) AS entry(value) LOOP
    IF NULLIF(v_entry->>'student_id', '') IS NULL THEN
      RAISE EXCEPTION 'Each attendance entry must include a student.'
        USING ERRCODE = '22023';
    END IF;

    v_student_id := (v_entry->>'student_id')::UUID;
    v_status := LOWER(BTRIM(v_entry->>'status'));

    IF v_status IS NULL OR v_status NOT IN ('present', 'late', 'absent') THEN
      RAISE EXCEPTION 'Attendance status must be Present, Late, or Absent.'
        USING ERRCODE = '22023';
    END IF;

    IF v_student_id = ANY(v_seen_student_ids) THEN
      RAISE EXCEPTION 'A student may only be submitted once per schedule.'
        USING ERRCODE = '22023';
    END IF;
    v_seen_student_ids := array_append(v_seen_student_ids, v_student_id);

    IF NOT public.teacher_owns_attendance_record(
      v_student_id,
      p_schedule_id,
      v_schedule.section_id::TEXT
    ) THEN
      RAISE EXCEPTION 'One or more students are not assigned to this teacher schedule.'
        USING ERRCODE = '42501';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.attendance existing
      WHERE existing.student_id = v_student_id
        AND existing.schedule_id = p_schedule_id
        AND existing.attendance_date::TEXT = v_attendance_date
    ) THEN
      v_duplicate_student_ids := v_duplicate_student_ids || jsonb_build_array(v_student_id);
      CONTINUE;
    END IF;

    v_time_in := CASE
      WHEN v_status = 'absent' THEN NULL
      ELSE TO_CHAR(v_local_now, 'FMHH12:MI AM')
    END;

    BEGIN
      INSERT INTO public.attendance (
        student_id,
        teacher_id,
        attendance_date,
        time_in,
        status,
        schedule_id,
        subject_id,
        subject,
        section_id,
        is_late,
        guardian_email_sent
      )
      VALUES (
        v_student_id,
        v_teacher_id,
        v_attendance_date,
        v_time_in,
        v_status,
        p_schedule_id,
        v_schedule.subject_id,
        COALESCE(to_jsonb(v_schedule)->>'subject_name', to_jsonb(v_schedule)->>'subject'),
        v_schedule.section_id,
        v_status = 'late',
        FALSE
      );
      v_recorded_count := v_recorded_count + 1;
    EXCEPTION
      WHEN unique_violation THEN
        v_duplicate_student_ids := v_duplicate_student_ids || jsonb_build_array(v_student_id);
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'recorded_count', v_recorded_count,
    'duplicate_student_ids', v_duplicate_student_ids,
    'attendance_date', v_attendance_date
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_teacher_manual_attendance(BIGINT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_teacher_manual_attendance(BIGINT, JSONB) TO authenticated;

COMMIT;
