-- Teacher-only access restrictions
-- This enforces the rule that teachers can only view and modify data tied to their own teacher_id

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grades ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "teachers_can_view_own_profile_only" ON public.profiles;
CREATE POLICY "teachers_can_view_own_profile_only"
ON public.profiles
FOR SELECT
USING (
  id = auth.uid()
  OR (
    auth.uid() IS NOT NULL
    AND role = 'STUDENT'
    AND EXISTS (
      SELECT 1
      FROM public.schedules s
      WHERE s.teacher_id = auth.uid()
        AND s.section_id = profiles.section_id
    )
  )
);

DROP POLICY IF EXISTS "teachers_cannot_update_other_profiles" ON public.profiles;
CREATE POLICY "teachers_cannot_update_other_profiles"
ON public.profiles
FOR UPDATE
USING (id = auth.uid())
WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "teachers_manage_own_schedules" ON public.schedules;
CREATE POLICY "teachers_manage_own_schedules"
ON public.schedules
FOR ALL
USING (teacher_id = auth.uid())
WITH CHECK (teacher_id = auth.uid());

DROP POLICY IF EXISTS "teachers_view_own_attendance" ON public.attendance;
CREATE POLICY "teachers_view_own_attendance"
ON public.attendance
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.schedules s
    WHERE s.id = attendance.schedule_id
      AND s.teacher_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "teachers_manage_own_attendance" ON public.attendance;
CREATE POLICY "teachers_manage_own_attendance"
ON public.attendance
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.schedules s
    WHERE s.id = attendance.schedule_id
      AND s.teacher_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "teachers_update_own_attendance" ON public.attendance;
CREATE POLICY "teachers_update_own_attendance"
ON public.attendance
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM public.schedules s
    WHERE s.id = attendance.schedule_id
      AND s.teacher_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.schedules s
    WHERE s.id = attendance.schedule_id
      AND s.teacher_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "teachers_delete_own_attendance" ON public.attendance;
CREATE POLICY "teachers_delete_own_attendance"
ON public.attendance
FOR DELETE
USING (
  EXISTS (
    SELECT 1
    FROM public.schedules s
    WHERE s.id = attendance.schedule_id
      AND s.teacher_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "teachers_manage_own_grades" ON public.grades;
CREATE POLICY "teachers_manage_own_grades"
ON public.grades
FOR ALL
USING (teacher_id = auth.uid())
WITH CHECK (teacher_id = auth.uid());
