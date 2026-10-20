DROP TRIGGER IF EXISTS profiles_protect_archive_metadata ON public.profiles;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'archived_section_id'
      AND data_type <> 'text'
  ) THEN
    ALTER TABLE public.profiles
      ALTER COLUMN archived_section_id TYPE TEXT
      USING archived_section_id::TEXT;
  END IF;
END;
$$;

CREATE TRIGGER profiles_protect_archive_metadata
BEFORE UPDATE OF archive_reason, archived_at, archived_by, archived_by_name, archived_section_id
ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_profile_archive_metadata();
