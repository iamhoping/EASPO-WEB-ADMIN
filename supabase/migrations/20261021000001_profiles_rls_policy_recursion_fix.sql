-- Remove legacy policies that query profiles from policies on profiles.
DROP POLICY IF EXISTS "Admins can delete profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can insert any profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can manage profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can update all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can update any profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can update profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.profiles;
DROP POLICY IF EXISTS "Teachers can view students" ON public.profiles;
DROP POLICY IF EXISTS "Web admins can read profiles" ON public.profiles;

-- Recreate administrator access through role helpers that read profiles with
-- RLS bypass enabled, rather than through recursive policy subqueries.
DROP POLICY IF EXISTS "school_admin_read_school_profiles" ON public.profiles;
CREATE POLICY "school_admin_read_school_profiles"
ON public.profiles FOR SELECT
USING (
  public.is_school_admin()
  AND (id = auth.uid() OR role IN ('STUDENT', 'TEACHER', 'PARENT'))
);

DROP POLICY IF EXISTS "web_admin_manage_profiles" ON public.profiles;
CREATE POLICY "web_admin_manage_profiles"
ON public.profiles FOR ALL
USING (public.is_web_admin())
WITH CHECK (public.is_web_admin());

DROP POLICY IF EXISTS "school_admin_create_school_profiles" ON public.profiles;
CREATE POLICY "school_admin_create_school_profiles"
ON public.profiles FOR INSERT
WITH CHECK (
  public.is_school_admin()
  AND role IN ('STUDENT', 'TEACHER', 'PARENT')
);

DROP POLICY IF EXISTS "school_admin_update_school_profiles" ON public.profiles;
CREATE POLICY "school_admin_update_school_profiles"
ON public.profiles FOR UPDATE
USING (
  public.is_school_admin()
  AND role IN ('STUDENT', 'TEACHER', 'PARENT')
)
WITH CHECK (
  public.is_school_admin()
  AND role IN ('STUDENT', 'TEACHER', 'PARENT')
);

DROP POLICY IF EXISTS "school_admin_scope_profiles_select" ON public.profiles;
CREATE POLICY "school_admin_scope_profiles_select"
ON public.profiles AS RESTRICTIVE FOR SELECT
USING (
  NOT public.is_school_admin()
  OR id = auth.uid()
  OR role IN ('STUDENT', 'TEACHER', 'PARENT')
);

DROP POLICY IF EXISTS "school_admin_scope_profiles_insert" ON public.profiles;
CREATE POLICY "school_admin_scope_profiles_insert"
ON public.profiles AS RESTRICTIVE FOR INSERT
WITH CHECK (
  NOT public.is_school_admin()
  OR role IN ('STUDENT', 'TEACHER', 'PARENT')
);

DROP POLICY IF EXISTS "school_admin_scope_profiles_update" ON public.profiles;
CREATE POLICY "school_admin_scope_profiles_update"
ON public.profiles AS RESTRICTIVE FOR UPDATE
USING (
  NOT public.is_school_admin()
  OR role IN ('STUDENT', 'TEACHER', 'PARENT')
)
WITH CHECK (
  NOT public.is_school_admin()
  OR role IN ('STUDENT', 'TEACHER', 'PARENT')
);

DROP POLICY IF EXISTS "school_admin_cannot_delete_profiles" ON public.profiles;
CREATE POLICY "school_admin_cannot_delete_profiles"
ON public.profiles AS RESTRICTIVE FOR DELETE
USING (NOT public.is_school_admin());

DROP POLICY IF EXISTS "active_authenticated_profiles_select" ON public.profiles;
CREATE POLICY "active_authenticated_profiles_select"
ON public.profiles AS RESTRICTIVE FOR SELECT
USING (public.is_active_authenticated_user() OR id = auth.uid());

DROP POLICY IF EXISTS "active_authenticated_profiles_insert" ON public.profiles;
CREATE POLICY "active_authenticated_profiles_insert"
ON public.profiles AS RESTRICTIVE FOR INSERT
WITH CHECK (public.is_active_authenticated_user());

DROP POLICY IF EXISTS "active_authenticated_profiles_update" ON public.profiles;
CREATE POLICY "active_authenticated_profiles_update"
ON public.profiles AS RESTRICTIVE FOR UPDATE
USING (public.is_active_authenticated_user())
WITH CHECK (public.is_active_authenticated_user());

DROP POLICY IF EXISTS "active_authenticated_profiles_delete" ON public.profiles;
CREATE POLICY "active_authenticated_profiles_delete"
ON public.profiles AS RESTRICTIVE FOR DELETE
USING (public.is_active_authenticated_user());

-- Teachers can read their own profile and students in their scheduled sections.
DROP POLICY IF EXISTS "teachers_can_view_own_profile_only" ON public.profiles;
CREATE POLICY "teachers_can_view_own_profile_only"
ON public.profiles FOR SELECT
USING (
  id = auth.uid()
  OR (
    public.is_teacher()
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
ON public.profiles FOR UPDATE
USING (id = auth.uid())
WITH CHECK (id = auth.uid());
