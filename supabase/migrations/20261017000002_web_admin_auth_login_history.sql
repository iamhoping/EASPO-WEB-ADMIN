CREATE OR REPLACE FUNCTION public.web_admin_auth_login_history(p_limit INTEGER DEFAULT 100)
RETURNS TABLE (
  event_at TIMESTAMPTZ,
  action TEXT,
  actor_id TEXT,
  actor_name TEXT,
  actor_username TEXT,
  ip_address TEXT,
  provider TEXT
)
LANGUAGE PLPGSQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_web_admin() THEN
    RAISE EXCEPTION 'Only an active Web Admin can view Auth login history.'
      USING ERRCODE = '42501';
  END IF;

  IF to_regclass('auth.audit_log_entries') IS NULL THEN
    RAISE EXCEPTION 'Supabase Auth audit log database storage is not enabled. Enable database storage for Auth Audit Logs in the Supabase Dashboard.'
      USING ERRCODE = '55000';
  END IF;

  RETURN QUERY EXECUTE $query$
    SELECT
      logs.created_at,
      logs.payload ->> 'action',
      NULLIF(logs.payload ->> 'actor_id', ''),
      NULLIF(logs.payload ->> 'actor_name', ''),
      NULLIF(logs.payload ->> 'actor_username', ''),
      logs.ip_address::TEXT,
      COALESCE(
        logs.payload #>> '{traits,provider}',
        logs.payload #>> '{traits,provider_type}'
      )
    FROM auth.audit_log_entries AS logs
    WHERE logs.payload ->> 'action' IN ('login', 'mfa_code_login')
    ORDER BY logs.created_at DESC
    LIMIT $1
  $query$ USING LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200);
END;
$$;

REVOKE ALL ON FUNCTION public.web_admin_auth_login_history(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.web_admin_auth_login_history(INTEGER) TO authenticated;
