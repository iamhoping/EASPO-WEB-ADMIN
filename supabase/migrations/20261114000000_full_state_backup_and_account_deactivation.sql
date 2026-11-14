-- A deleted account is a reversible deactivation.  It is deliberately distinct
-- from archived accounts, which remain an operational/records-management state.
CREATE INDEX IF NOT EXISTS profiles_deleted_accounts_idx
  ON public.profiles (role, id)
  WHERE lower(coalesce(status, 'active')) = 'deleted';

-- This applies even to administrators using normal application queries.  The
-- service-role backup path bypasses RLS, so deactivated records remain safe.
DROP POLICY IF EXISTS "hide_deactivated_profiles" ON public.profiles;
CREATE POLICY "hide_deactivated_profiles"
ON public.profiles AS RESTRICTIVE FOR SELECT TO authenticated
USING (lower(coalesce(status, 'active')) <> 'deleted');

CREATE OR REPLACE FUNCTION public.is_active_authenticated_user()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND lower(coalesce(status, 'active')) IN ('inactive', 'archived', 'deleted')
    );
$$;

-- Full backups always carry every supported data set.  Restore is deliberately
-- replacement based: rows absent from the selected backup are removed.
CREATE OR REPLACE FUNCTION public.validate_easpo_backup(p_rows JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  dataset RECORD; rows_json JSONB; backup_field_name TEXT; required_column TEXT;
  required_columns TEXT[]; row_data JSONB; result JSONB := '{}'::JSONB;
  validated_record RECORD; total_records INTEGER := 0;
BEGIN
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Backup rows must be a JSON object.'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_rows) supplied(name) WHERE name NOT IN
    ('sections','subjects','students','teachers','parents','school_admins','web_admins','scanners','schedules','grades','attendance','system_settings')) THEN
    RAISE EXCEPTION 'Backup contains an unsupported dataset.';
  END IF;
  FOR dataset IN SELECT * FROM (VALUES
    ('sections','sections',NULL::TEXT), ('subjects','subjects',NULL::TEXT),
    ('students','profiles','STUDENT'), ('teachers','profiles','TEACHER'),
    ('parents','profiles','PARENT'), ('school_admins','profiles','SCHOOL_ADMIN'),
    ('web_admins','profiles','WEB_ADMIN'), ('scanners','profiles','SCANNER'),
    ('schedules','schedules',NULL::TEXT),
    ('grades','grades',NULL::TEXT), ('attendance','attendance',NULL::TEXT),
    ('system_settings','system_settings',NULL::TEXT)
  ) AS x(dataset_name, relation_name, profile_role) LOOP
    IF NOT (p_rows ? dataset.dataset_name) THEN RAISE EXCEPTION 'Full backup is missing dataset %.', dataset.dataset_name; END IF;
    rows_json := p_rows -> dataset.dataset_name;
    IF jsonb_typeof(rows_json) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Dataset % must contain an array of records.', dataset.dataset_name; END IF;
    total_records := total_records + jsonb_array_length(rows_json);
    IF total_records > 50000 THEN RAISE EXCEPTION 'Backup exceeds the record safety limit.'; END IF;
    SELECT array_agg(c.column_name) INTO required_columns FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.table_name = dataset.relation_name
        AND c.is_nullable = 'NO' AND c.is_generated = 'NEVER';
    FOR row_data IN SELECT value FROM jsonb_array_elements(rows_json) LOOP
      IF jsonb_typeof(row_data) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Dataset % contains a record that is not an object.', dataset.dataset_name; END IF;
      IF dataset.profile_role IS NOT NULL AND row_data->>'role' IS DISTINCT FROM dataset.profile_role THEN RAISE EXCEPTION 'Dataset % contains an account with the wrong role.', dataset.dataset_name; END IF;
      FOR backup_field_name IN SELECT jsonb_object_keys(row_data) LOOP
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name=dataset.relation_name AND c.column_name=backup_field_name) THEN RAISE EXCEPTION 'Dataset % contains an unsupported record field.', dataset.dataset_name; END IF;
      END LOOP;
      FOREACH required_column IN ARRAY coalesce(required_columns, ARRAY[]::TEXT[]) LOOP
        IF NOT (row_data ? required_column) OR row_data->required_column = 'null'::jsonb THEN RAISE EXCEPTION 'Dataset % is missing a required record value.', dataset.dataset_name; END IF;
      END LOOP;
      BEGIN EXECUTE format('SELECT incoming.* FROM jsonb_populate_record(NULL::public.%I, $1) incoming', dataset.relation_name) INTO validated_record USING row_data;
      EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Dataset % contains invalid record values.', dataset.dataset_name; END;
    END LOOP;
    result := result || jsonb_build_object(dataset.dataset_name, jsonb_array_length(rows_json));
  END LOOP;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_easpo_backup(p_rows JSONB, p_full_state BOOLEAN DEFAULT TRUE)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE dataset RECORD; rows_json JSONB; restored_count INTEGER; result JSONB := '{}'::JSONB;
BEGIN
  PERFORM public.validate_easpo_backup(p_rows);
  -- A complete backup replaces state. A date-scoped backup is deliberately
  -- non-destructive: it only recovers missing records in its captured period.
  IF p_full_state THEN
    DELETE FROM public.attendance;
    DELETE FROM public.grades;
    DELETE FROM public.schedules;
    DELETE FROM public.profiles;
    DELETE FROM public.subjects;
    DELETE FROM public.sections;
    DELETE FROM public.system_settings;
  END IF;
  FOR dataset IN SELECT * FROM (VALUES
    ('sections','sections',NULL::TEXT), ('subjects','subjects',NULL::TEXT),
    ('students','profiles','STUDENT'), ('teachers','profiles','TEACHER'),
    ('parents','profiles','PARENT'), ('school_admins','profiles','SCHOOL_ADMIN'),
    ('web_admins','profiles','WEB_ADMIN'), ('scanners','profiles','SCANNER'),
    ('schedules','schedules',NULL::TEXT),
    ('grades','grades',NULL::TEXT), ('attendance','attendance',NULL::TEXT),
    ('system_settings','system_settings',NULL::TEXT)
  ) AS x(dataset_name, relation_name, profile_role) LOOP
    rows_json := p_rows -> dataset.dataset_name;
    IF dataset.relation_name = 'profiles' THEN
      IF p_full_state THEN
        EXECUTE 'INSERT INTO public.profiles OVERRIDING SYSTEM VALUE SELECT incoming.* FROM jsonb_populate_recordset(NULL::public.profiles, $1) incoming JOIN auth.users au ON au.id=incoming.id WHERE incoming.role=$2'
        USING rows_json, dataset.profile_role;
      ELSE
        EXECUTE 'INSERT INTO public.profiles OVERRIDING SYSTEM VALUE SELECT incoming.* FROM jsonb_populate_recordset(NULL::public.profiles, $1) incoming JOIN auth.users au ON au.id=incoming.id WHERE incoming.role=$2 ON CONFLICT DO NOTHING'
        USING rows_json, dataset.profile_role;
      END IF;
    ELSE
      IF p_full_state THEN
        EXECUTE format('INSERT INTO public.%I OVERRIDING SYSTEM VALUE SELECT incoming.* FROM jsonb_populate_recordset(NULL::public.%I, $1) incoming', dataset.relation_name, dataset.relation_name) USING rows_json;
      ELSE
        EXECUTE format('INSERT INTO public.%I OVERRIDING SYSTEM VALUE SELECT incoming.* FROM jsonb_populate_recordset(NULL::public.%I, $1) incoming ON CONFLICT DO NOTHING', dataset.relation_name, dataset.relation_name) USING rows_json;
      END IF;
    END IF;
    GET DIAGNOSTICS restored_count = ROW_COUNT;
    IF p_full_state AND restored_count <> jsonb_array_length(rows_json) THEN RAISE EXCEPTION 'Restore could not recover every % record; required Auth identities are missing.', dataset.dataset_name; END IF;
    result := result || jsonb_build_object(dataset.dataset_name, jsonb_build_object('requested',jsonb_array_length(rows_json),'restored',restored_count,'removed_after_backup',p_full_state));
  END LOOP;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_easpo_backup(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_easpo_backup(JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.restore_easpo_backup(JSONB, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_easpo_backup(JSONB, BOOLEAN) TO service_role;
