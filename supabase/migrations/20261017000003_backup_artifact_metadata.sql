ALTER TABLE public.system_backup_runs
  ADD COLUMN IF NOT EXISTS object_key TEXT,
  ADD COLUMN IF NOT EXISTS sha256 TEXT,
  ADD COLUMN IF NOT EXISTS size_bytes BIGINT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.system_backup_runs'::regclass
      AND conname = 'system_backup_runs_sha256_format'
  ) THEN
    ALTER TABLE public.system_backup_runs
      ADD CONSTRAINT system_backup_runs_sha256_format
      CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.system_backup_runs'::regclass
      AND conname = 'system_backup_runs_size_positive'
  ) THEN
    ALTER TABLE public.system_backup_runs
      ADD CONSTRAINT system_backup_runs_size_positive
      CHECK (size_bytes IS NULL OR size_bytes > 0);
  END IF;
END;
$$;
