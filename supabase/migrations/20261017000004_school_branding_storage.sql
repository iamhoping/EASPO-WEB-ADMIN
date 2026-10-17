INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'school-assets',
  'school-assets',
  TRUE,
  2097152,
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "public_read_school_logo" ON storage.objects;
CREATE POLICY "public_read_school_logo"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'school-assets' AND name LIKE 'school-logo/%');

DROP POLICY IF EXISTS "web_admin_upload_school_logo" ON storage.objects;
CREATE POLICY "web_admin_upload_school_logo"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'school-assets'
  AND name LIKE 'school-logo/%'
  AND public.is_web_admin()
  AND public.is_active_authenticated_user()
);

DROP POLICY IF EXISTS "web_admin_update_school_logo" ON storage.objects;
CREATE POLICY "web_admin_update_school_logo"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'school-assets'
  AND name LIKE 'school-logo/%'
  AND public.is_web_admin()
  AND public.is_active_authenticated_user()
)
WITH CHECK (
  bucket_id = 'school-assets'
  AND name LIKE 'school-logo/%'
  AND public.is_web_admin()
  AND public.is_active_authenticated_user()
);

DROP POLICY IF EXISTS "web_admin_delete_school_logo" ON storage.objects;
CREATE POLICY "web_admin_delete_school_logo"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'school-assets'
  AND name LIKE 'school-logo/%'
  AND public.is_web_admin()
  AND public.is_active_authenticated_user()
);

CREATE OR REPLACE FUNCTION public.get_public_school_branding()
RETURNS TABLE (key TEXT, value JSONB)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT settings.key, settings.value
  FROM public.system_settings AS settings
  WHERE settings.key IN ('school_name', 'school_logo_url', 'maintenance_announcement');
$$;

REVOKE ALL ON FUNCTION public.get_public_school_branding() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_school_branding() TO anon, authenticated;
