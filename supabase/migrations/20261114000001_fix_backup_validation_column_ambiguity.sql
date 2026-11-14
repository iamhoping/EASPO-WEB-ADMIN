-- Hosted Supabase does not permit changing plpgsql.variable_conflict. Replace
-- the function with an unambiguous definition instead.
CREATE OR REPLACE FUNCTION public.validate_easpo_backup(p_rows JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  dataset RECORD;
  rows_json JSONB;
  backup_field_name TEXT;
  required_field_name TEXT;
  required_fields TEXT[];
  row_data JSONB;
  validation_result JSONB := '{}'::JSONB;
  validated_record RECORD;
  total_records INTEGER := 0;
BEGIN
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Backup rows must be a JSON object.'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_rows) supplied(dataset_key) WHERE dataset_key NOT IN ('sections','subjects','students','teachers','parents','school_admins','web_admins','scanners','schedules','grades','attendance','system_settings')) THEN RAISE EXCEPTION 'Backup contains an unsupported dataset.'; END IF;

  FOR dataset IN SELECT * FROM (VALUES
    ('sections','sections',NULL::TEXT), ('subjects','subjects',NULL::TEXT),
    ('students','profiles','STUDENT'), ('teachers','profiles','TEACHER'),
    ('parents','profiles','PARENT'), ('school_admins','profiles','SCHOOL_ADMIN'),
    ('web_admins','profiles','WEB_ADMIN'), ('scanners','profiles','SCANNER'),
    ('schedules','schedules',NULL::TEXT),
    ('grades','grades',NULL::TEXT), ('attendance','attendance',NULL::TEXT),
    ('system_settings','system_settings',NULL::TEXT)
  ) AS item(dataset_name, relation_name, profile_role) LOOP
    IF NOT (p_rows ? dataset.dataset_name) THEN RAISE EXCEPTION 'Full backup is missing dataset %.', dataset.dataset_name; END IF;
    rows_json := p_rows -> dataset.dataset_name;
    IF jsonb_typeof(rows_json) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Dataset % must contain an array of records.', dataset.dataset_name; END IF;
    total_records := total_records + jsonb_array_length(rows_json);
    IF total_records > 50000 THEN RAISE EXCEPTION 'Backup exceeds the record safety limit.'; END IF;
    SELECT array_agg(schema_column.column_name) INTO required_fields
    FROM information_schema.columns AS schema_column
    WHERE schema_column.table_schema = 'public' AND schema_column.table_name = dataset.relation_name
      AND schema_column.is_nullable = 'NO' AND schema_column.is_generated = 'NEVER';
    FOR row_data IN SELECT value FROM jsonb_array_elements(rows_json) LOOP
      IF jsonb_typeof(row_data) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Dataset % contains a record that is not an object.', dataset.dataset_name; END IF;
      IF dataset.profile_role IS NOT NULL AND row_data->>'role' IS DISTINCT FROM dataset.profile_role THEN RAISE EXCEPTION 'Dataset % contains an account with the wrong role.', dataset.dataset_name; END IF;
      FOR backup_field_name IN SELECT jsonb_object_keys(row_data) LOOP
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns AS schema_column WHERE schema_column.table_schema = 'public' AND schema_column.table_name = dataset.relation_name AND schema_column.column_name = backup_field_name) THEN RAISE EXCEPTION 'Dataset % contains an unsupported record field.', dataset.dataset_name; END IF;
      END LOOP;
      FOREACH required_field_name IN ARRAY coalesce(required_fields, ARRAY[]::TEXT[]) LOOP
        IF NOT (row_data ? required_field_name) OR row_data -> required_field_name = 'null'::JSONB THEN RAISE EXCEPTION 'Dataset % is missing a required record value.', dataset.dataset_name; END IF;
      END LOOP;
      BEGIN
        EXECUTE format('SELECT incoming.* FROM jsonb_populate_record(NULL::public.%I, $1) AS incoming', dataset.relation_name) INTO validated_record USING row_data;
      EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Dataset % contains invalid record values.', dataset.dataset_name;
      END;
    END LOOP;
    validation_result := validation_result || jsonb_build_object(dataset.dataset_name, jsonb_array_length(rows_json));
  END LOOP;
  RETURN validation_result;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_easpo_backup(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_easpo_backup(JSONB) TO service_role;
