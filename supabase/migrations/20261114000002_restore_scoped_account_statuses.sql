-- Date-scoped restores preserve unrelated data, but profile rows already exist
-- after archive/deactivation. Restore their backed-up state so those accounts
-- become visible again when the snapshot says they were active.
CREATE OR REPLACE FUNCTION public.restore_easpo_backup_profile_states(p_rows JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  dataset RECORD;
  rows_json JSONB;
  restored_count INTEGER;
  result JSONB := '{}'::JSONB;
BEGIN
  PERFORM public.validate_easpo_backup(p_rows);
  FOR dataset IN SELECT * FROM (VALUES
    ('students', 'STUDENT'), ('teachers', 'TEACHER'), ('parents', 'PARENT'),
    ('school_admins', 'SCHOOL_ADMIN'), ('web_admins', 'WEB_ADMIN'), ('scanners', 'SCANNER')
  ) AS item(dataset_name, profile_role) LOOP
    rows_json := p_rows -> dataset.dataset_name;
    UPDATE public.profiles AS current_profile
    SET
      status = backup_profile.status,
      section_id = backup_profile.section_id,
      archive_reason = backup_profile.archive_reason,
      archived_at = backup_profile.archived_at,
      archived_by = backup_profile.archived_by,
      archived_by_name = backup_profile.archived_by_name,
      archived_section_id = backup_profile.archived_section_id
    FROM jsonb_populate_recordset(NULL::public.profiles, rows_json) AS backup_profile
    WHERE current_profile.id = backup_profile.id
      AND current_profile.role = dataset.profile_role;
    GET DIAGNOSTICS restored_count = ROW_COUNT;
    result := result || jsonb_build_object(dataset.dataset_name, restored_count);
  END LOOP;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.restore_easpo_backup_profile_states(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_easpo_backup_profile_states(JSONB) TO service_role;
