ALTER TABLE public.system_backup_runs
  ADD COLUMN IF NOT EXISTS backup_type TEXT NOT NULL DEFAULT 'database_dump'
    CHECK (backup_type IN ('database_dump', 'data_export')),
  ADD COLUMN IF NOT EXISTS included_tables TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS date_from DATE,
  ADD COLUMN IF NOT EXISTS date_to DATE,
  ADD COLUMN IF NOT EXISTS actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.system_backup_runs
  DROP CONSTRAINT IF EXISTS system_backup_runs_date_range_check;
ALTER TABLE public.system_backup_runs
  ADD CONSTRAINT system_backup_runs_date_range_check
  CHECK (date_from IS NULL OR date_to IS NULL OR date_from <= date_to);

GRANT DELETE ON public.system_backup_runs TO service_role;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'easpo-backups',
  'easpo-backups',
  FALSE,
  10485760,
  ARRAY['application/octet-stream']
)
ON CONFLICT (id) DO UPDATE
SET public = FALSE,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE OR REPLACE FUNCTION public.validate_easpo_backup(p_rows JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  dataset RECORD;
  rows_json JSONB;
  column_name TEXT;
  required_column TEXT;
  required_columns TEXT[];
  row_data JSONB;
  result JSONB := '{}'::JSONB;
  validated_record RECORD;
  total_records INTEGER := 0;
  allowed_datasets TEXT[] := ARRAY[
    'sections', 'subjects', 'students', 'teachers', 'parents',
    'schedules', 'grades', 'attendance', 'system_settings'
  ];
BEGIN
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Backup rows must be a JSON object.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(p_rows) AS supplied(dataset_name)
    WHERE NOT supplied.dataset_name = ANY (allowed_datasets)
  ) THEN
    RAISE EXCEPTION 'Backup contains an unsupported dataset.';
  END IF;

  FOR dataset IN
    SELECT *
    FROM (VALUES
      ('sections', 'sections', NULL::TEXT),
      ('subjects', 'subjects', NULL::TEXT),
      ('students', 'profiles', 'STUDENT'),
      ('teachers', 'profiles', 'TEACHER'),
      ('parents', 'profiles', 'PARENT'),
      ('schedules', 'schedules', NULL::TEXT),
      ('grades', 'grades', NULL::TEXT),
      ('attendance', 'attendance', NULL::TEXT),
      ('system_settings', 'system_settings', NULL::TEXT)
    ) AS restore_order(dataset_name, relation_name, profile_role)
  LOOP
    rows_json := COALESCE(p_rows -> dataset.dataset_name, '[]'::JSONB);
    IF jsonb_typeof(rows_json) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Dataset % must contain an array of records.', dataset.dataset_name;
    END IF;
    total_records := total_records + jsonb_array_length(rows_json);
    IF total_records > 50000 THEN
      RAISE EXCEPTION 'Backup exceeds the record safety limit.';
    END IF;

    SELECT array_agg(column_info.column_name)
      INTO required_columns
    FROM information_schema.columns AS column_info
    WHERE column_info.table_schema = 'public'
      AND column_info.table_name = dataset.relation_name
      AND column_info.is_nullable = 'NO'
      AND column_info.is_generated = 'NEVER';

    FOR row_data IN SELECT value FROM jsonb_array_elements(rows_json)
    LOOP
      IF jsonb_typeof(row_data) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'Dataset % contains a record that is not an object.', dataset.dataset_name;
      END IF;

      FOR column_name IN SELECT jsonb_object_keys(row_data)
      LOOP
        IF NOT EXISTS (
          SELECT 1
          FROM information_schema.columns AS column_info
          WHERE column_info.table_schema = 'public'
            AND column_info.table_name = dataset.relation_name
            AND column_info.column_name = column_name
        ) THEN
          RAISE EXCEPTION 'Dataset % contains an unsupported record field.', dataset.dataset_name;
        END IF;
      END LOOP;

      FOREACH required_column IN ARRAY COALESCE(required_columns, ARRAY[]::TEXT[])
      LOOP
        IF NOT (row_data ? required_column) OR row_data -> required_column = 'null'::JSONB THEN
          RAISE EXCEPTION 'Dataset % is missing a required record value.', dataset.dataset_name;
        END IF;
      END LOOP;

      BEGIN
        EXECUTE format(
          'SELECT incoming.* FROM jsonb_populate_record(NULL::public.%I, $1) AS incoming',
          dataset.relation_name
        )
        INTO validated_record
        USING row_data;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Dataset % contains invalid record values.', dataset.dataset_name;
      END;
    END LOOP;

    result := result || jsonb_build_object(dataset.dataset_name, jsonb_array_length(rows_json));
  END LOOP;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_easpo_backup(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_easpo_backup(JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.restore_easpo_backup(p_rows JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  dataset RECORD;
  rows_json JSONB;
  requested_count INTEGER;
  inserted_count INTEGER;
  sequence_name TEXT;
  sequence_max BIGINT;
  sequence_last BIGINT;
  sequence_table TEXT;
  result JSONB := '{}'::JSONB;
BEGIN
  PERFORM public.validate_easpo_backup(p_rows);

  FOR dataset IN
    SELECT *
    FROM (VALUES
      ('sections', 'sections', NULL::TEXT),
      ('subjects', 'subjects', NULL::TEXT),
      ('students', 'profiles', 'STUDENT'),
      ('teachers', 'profiles', 'TEACHER'),
      ('parents', 'profiles', 'PARENT'),
      ('schedules', 'schedules', NULL::TEXT),
      ('grades', 'grades', NULL::TEXT),
      ('attendance', 'attendance', NULL::TEXT),
      ('system_settings', 'system_settings', NULL::TEXT)
    ) AS restore_order(dataset_name, relation_name, profile_role)
  LOOP
    rows_json := COALESCE(p_rows -> dataset.dataset_name, '[]'::JSONB);
    requested_count := jsonb_array_length(rows_json);

    IF dataset.relation_name = 'profiles' THEN
      EXECUTE
        'INSERT INTO public.profiles OVERRIDING SYSTEM VALUE ' ||
        'SELECT incoming.* ' ||
        'FROM jsonb_populate_recordset(NULL::public.profiles, $1) AS incoming ' ||
        'JOIN auth.users AS auth_user ON auth_user.id = incoming.id ' ||
        'WHERE incoming.role = $2 ' ||
        'AND incoming.id IS NOT NULL ' ||
        'ON CONFLICT DO NOTHING'
      USING rows_json, dataset.profile_role;
    ELSE
      EXECUTE format(
        'INSERT INTO public.%I OVERRIDING SYSTEM VALUE ' ||
        'SELECT incoming.* ' ||
        'FROM jsonb_populate_recordset(NULL::public.%I, $1) AS incoming ' ||
        'ON CONFLICT DO NOTHING',
        dataset.relation_name,
        dataset.relation_name
      )
      USING rows_json;
    END IF;

    GET DIAGNOSTICS inserted_count = ROW_COUNT;
    result := result || jsonb_build_object(
      dataset.dataset_name,
      jsonb_build_object(
        'requested', requested_count,
        'inserted', inserted_count,
        'skipped', requested_count - inserted_count
      )
    );
  END LOOP;

  FOR sequence_table IN
    SELECT table_name
    FROM (VALUES
      ('sections'),
      ('subjects'),
      ('schedules'),
      ('grades'),
      ('attendance')
    ) AS sequence_tables(table_name)
  LOOP
    sequence_name := pg_get_serial_sequence(format('public.%I', sequence_table), 'id');
    IF sequence_name IS NOT NULL THEN
      EXECUTE format('SELECT MAX(id)::BIGINT FROM public.%I', sequence_table) INTO sequence_max;
      IF sequence_max IS NOT NULL THEN
        EXECUTE format('SELECT last_value FROM %s', sequence_name::REGCLASS) INTO sequence_last;
        EXECUTE format(
          'ALTER SEQUENCE %s RESTART WITH %s',
          sequence_name::REGCLASS,
          GREATEST(sequence_max, sequence_last) + 1
        );
      END IF;
    END IF;
  END LOOP;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.restore_easpo_backup(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_easpo_backup(JSONB) TO service_role;
