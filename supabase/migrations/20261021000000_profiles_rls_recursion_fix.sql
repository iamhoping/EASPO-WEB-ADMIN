-- Profile RLS policies call these SECURITY DEFINER helpers. Their lookups of
-- profiles must bypass RLS to avoid recursively evaluating the same policies.
ALTER FUNCTION public.is_school_admin() OWNER TO postgres;
ALTER FUNCTION public.is_school_admin() SET row_security = off;
ALTER FUNCTION public.is_school_admin() SET search_path = pg_catalog, public, auth, pg_temp;
ALTER FUNCTION public.is_web_admin() OWNER TO postgres;
ALTER FUNCTION public.is_web_admin() SET row_security = off;
ALTER FUNCTION public.is_web_admin() SET search_path = pg_catalog, public, auth, pg_temp;
ALTER FUNCTION public.is_teacher() OWNER TO postgres;
ALTER FUNCTION public.is_teacher() SET row_security = off;
ALTER FUNCTION public.is_teacher() SET search_path = pg_catalog, public, auth, pg_temp;
ALTER FUNCTION public.is_scanner() OWNER TO postgres;
ALTER FUNCTION public.is_scanner() SET row_security = off;
ALTER FUNCTION public.is_scanner() SET search_path = pg_catalog, public, auth, pg_temp;
ALTER FUNCTION public.is_active_authenticated_user() OWNER TO postgres;
ALTER FUNCTION public.is_active_authenticated_user() SET row_security = off;
ALTER FUNCTION public.is_active_authenticated_user() SET search_path = pg_catalog, public, auth, pg_temp;

ALTER FUNCTION public.can_view_student_portal_profile(UUID) OWNER TO postgres;
ALTER FUNCTION public.can_view_student_portal_profile(UUID) SET row_security = off;
ALTER FUNCTION public.can_view_student_portal_profile(UUID) SET search_path = pg_catalog, public, auth, pg_temp;
ALTER FUNCTION public.can_view_student_portal_section(UUID) OWNER TO postgres;
ALTER FUNCTION public.can_view_student_portal_section(UUID) SET row_security = off;
ALTER FUNCTION public.can_view_student_portal_section(UUID) SET search_path = pg_catalog, public, auth, pg_temp;
ALTER FUNCTION public.can_view_student_portal_section(BIGINT) OWNER TO postgres;
ALTER FUNCTION public.can_view_student_portal_section(BIGINT) SET row_security = off;
ALTER FUNCTION public.can_view_student_portal_section(BIGINT) SET search_path = pg_catalog, public, auth, pg_temp;
ALTER FUNCTION public.get_student_portal_teacher_names(UUID) OWNER TO postgres;
ALTER FUNCTION public.get_student_portal_teacher_names(UUID) SET row_security = off;
ALTER FUNCTION public.get_student_portal_teacher_names(UUID) SET search_path = pg_catalog, public, auth, pg_temp;
ALTER FUNCTION public.get_student_portal_guardians(UUID) OWNER TO postgres;
ALTER FUNCTION public.get_student_portal_guardians(UUID) SET row_security = off;
ALTER FUNCTION public.get_student_portal_guardians(UUID) SET search_path = pg_catalog, public, auth, pg_temp;

-- Keep trigger-side profile reads independent from caller RLS policies too.
ALTER FUNCTION public.protect_profile_roles() OWNER TO postgres;
ALTER FUNCTION public.protect_profile_roles() SET row_security = off;
ALTER FUNCTION public.protect_profile_roles() SET search_path = pg_catalog, public, auth, pg_temp;
ALTER FUNCTION public.validate_schedule_assignments() OWNER TO postgres;
ALTER FUNCTION public.validate_schedule_assignments() SET row_security = off;
ALTER FUNCTION public.validate_schedule_assignments() SET search_path = pg_catalog, public, auth, pg_temp;
ALTER FUNCTION public.write_activity_log() OWNER TO postgres;
ALTER FUNCTION public.write_activity_log() SET row_security = off;
ALTER FUNCTION public.write_activity_log() SET search_path = pg_catalog, public, auth, pg_temp;

REVOKE ALL ON FUNCTION public.is_school_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_web_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_teacher() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_scanner() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_active_authenticated_user() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_school_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_web_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_teacher() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_scanner() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_authenticated_user() TO authenticated;

REVOKE ALL ON FUNCTION public.can_view_student_portal_profile(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_view_student_portal_section(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_view_student_portal_section(BIGINT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_student_portal_teacher_names(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_student_portal_guardians(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_student_portal_profile(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_student_portal_section(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_student_portal_section(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_student_portal_teacher_names(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_student_portal_guardians(UUID) TO authenticated;
