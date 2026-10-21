CREATE OR REPLACE FUNCTION public.validate_easpo_backup(p_rows JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_dataset_name TEXT;
  v_relation_name TEXT;
  v_column_name TEXT;
  v_data_type TEXT;
  v_udt_name TEXT;
  v_is_nullable TEXT;
  v_is_generated TEXT;
  v_rows JSONB;
  v_row JSONB;
  v_result JSONB := '{}'::JSONB;
  v_cast_result TEXT;
  v_row_number INTEGER;
  v_unsupported_dataset TEXT;
  v_total_records INTEGER := 0;
  v_allowed_datasets TEXT[] := ARRAY[
    'sections', 'subjects', 'students', 'teachers', 'parents',
    'schedules', 'grades', 'attendance', 'system_settings'
  ];
BEGIN
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Backup field "records" must be a JSON object.';
  END IF;

  SELECT supplied.dataset_name
    INTO v_unsupported_dataset
  FROM jsonb_object_keys(p_rows) AS supplied(dataset_name)
  WHERE NOT supplied.dataset_name = ANY (v_allowed_datasets)
  LIMIT 1;
  IF v_unsupported_dataset IS NOT NULL THEN
    RAISE EXCEPTION 'Backup contains unsupported dataset "%".', v_unsupported_dataset;
  END IF;

  FOR v_dataset_name, v_relation_name IN
    SELECT *
    FROM (VALUES
      ('sections', 'sections'),
      ('subjects', 'subjects'),
      ('students', 'profiles'),
      ('teachers', 'profiles'),
      ('parents', 'profiles'),
      ('schedules', 'schedules'),
      ('grades', 'grades'),
      ('attendance', 'attendance'),
      ('system_settings', 'system_settings')
    ) AS restore_order(dataset_name, relation_name)
  LOOP
    v_rows := COALESCE(p_rows -> v_dataset_name, '[]'::JSONB);
    IF jsonb_typeof(v_rows) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Dataset "%" must be an array of records.', v_dataset_name;
    END IF;

    v_total_records := v_total_records + jsonb_array_length(v_rows);
    IF v_total_records > 50000 THEN
      RAISE EXCEPTION 'Backup exceeds the 50000-record safety limit.';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns AS info
      WHERE info.table_schema = 'public'
        AND info.table_name = v_relation_name
    ) THEN
      RAISE EXCEPTION 'Dataset "%" expects public.% but that table is missing from the database schema.',
        v_dataset_name, v_relation_name;
    END IF;

    v_row_number := 0;
    FOR v_row IN SELECT value FROM jsonb_array_elements(v_rows)
    LOOP
      v_row_number := v_row_number + 1;
      IF jsonb_typeof(v_row) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'Dataset "%", record % must be a JSON object.',
          v_dataset_name, v_row_number;
      END IF;

      FOR v_column_name, v_data_type, v_udt_name, v_is_nullable, v_is_generated IN
        SELECT
          info.column_name::TEXT,
          info.data_type::TEXT,
          info.udt_name::TEXT,
          info.is_nullable::TEXT,
          info.is_generated::TEXT
        FROM information_schema.columns AS info
        WHERE info.table_schema = 'public'
          AND info.table_name = v_relation_name
      LOOP
        IF v_is_nullable = 'NO'
           AND v_is_generated = 'NEVER'
           AND NOT (v_row ? v_column_name) THEN
          RAISE EXCEPTION 'Dataset "%", record % is missing required field "%".',
            v_dataset_name, v_row_number, v_column_name;
        END IF;
        IF v_is_nullable = 'NO'
           AND v_is_generated = 'NEVER'
           AND v_row -> v_column_name = 'null'::JSONB THEN
          RAISE EXCEPTION 'Dataset "%", record % has null for required field "%".',
            v_dataset_name, v_row_number, v_column_name;
        END IF;
      END LOOP;

      FOR v_column_name IN
        SELECT supplied.key::TEXT
        FROM jsonb_object_keys(v_row) AS supplied(key)
      LOOP
        IF NOT EXISTS (
          SELECT 1
          FROM information_schema.columns AS info
          WHERE info.table_schema = 'public'
            AND info.table_name = v_relation_name
            AND info.column_name = v_column_name
        ) THEN
          RAISE EXCEPTION 'Dataset "%", record % contains unsupported field "%".',
            v_dataset_name, v_row_number, v_column_name;
        END IF;
      END LOOP;

      FOR v_column_name, v_data_type, v_udt_name IN
        SELECT info.column_name::TEXT, info.data_type::TEXT, info.udt_name::TEXT
        FROM information_schema.columns AS info
        JOIN jsonb_object_keys(v_row) AS supplied(key)
          ON supplied.key = info.column_name
        WHERE info.table_schema = 'public'
          AND info.table_name = v_relation_name
      LOOP
        BEGIN
          EXECUTE format(
            'SELECT ((jsonb_populate_record(NULL::public.%I, jsonb_build_object(%L, $1))).%I)::TEXT',
            v_relation_name,
            v_column_name,
            v_column_name
          )
          INTO v_cast_result
          USING v_row -> v_column_name;
        EXCEPTION WHEN OTHERS THEN
          RAISE EXCEPTION 'Dataset "%", record %, field "%" has an invalid value for database type % (%).',
            v_dataset_name, v_row_number, v_column_name, v_data_type, v_udt_name;
        END;
      END LOOP;
    END LOOP;

    v_result := v_result || jsonb_build_object(v_dataset_name, jsonb_array_length(v_rows));
  END LOOP;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_easpo_backup(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_easpo_backup(JSONB) TO service_role;
