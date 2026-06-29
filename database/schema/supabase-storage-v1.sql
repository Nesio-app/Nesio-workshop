-- Nesio Supabase Storage v1
-- Private product assets for avatars, Memory photos, audio, PDFs, and attachments.
-- Apply only after CEO-approved production data operation window.

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'nesio-product-assets',
  'nesio-product-assets',
  false,
  8388608,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
    'audio/mpeg',
    'audio/mp4',
    'audio/webm',
    'audio/wav',
    'application/pdf',
    'text/plain'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "nesio_assets_select_own_prefix" ON storage.objects;
CREATE POLICY "nesio_assets_select_own_prefix"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'nesio-product-assets'
  AND (storage.foldername(name))[1] = replace('supabase:' || auth.uid()::text, ':', '-')
);

DROP POLICY IF EXISTS "nesio_assets_insert_own_prefix" ON storage.objects;
CREATE POLICY "nesio_assets_insert_own_prefix"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'nesio-product-assets'
  AND (storage.foldername(name))[1] = replace('supabase:' || auth.uid()::text, ':', '-')
);

DROP POLICY IF EXISTS "nesio_assets_update_own_prefix" ON storage.objects;
CREATE POLICY "nesio_assets_update_own_prefix"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'nesio-product-assets'
  AND (storage.foldername(name))[1] = replace('supabase:' || auth.uid()::text, ':', '-')
)
WITH CHECK (
  bucket_id = 'nesio-product-assets'
  AND (storage.foldername(name))[1] = replace('supabase:' || auth.uid()::text, ':', '-')
);

DROP POLICY IF EXISTS "nesio_assets_delete_own_prefix" ON storage.objects;
CREATE POLICY "nesio_assets_delete_own_prefix"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'nesio-product-assets'
  AND (storage.foldername(name))[1] = replace('supabase:' || auth.uid()::text, ':', '-')
);
