CREATE TABLE IF NOT EXISTS public.dropbox_images_index (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    dropbox_path TEXT NOT NULL UNIQUE,
    dropbox_shared_link TEXT,
    tags TEXT[] DEFAULT '{}',
    last_scanned_at TIMESTAMPTZ DEFAULT now(),
    status TEXT DEFAULT 'scanned'
);

ALTER TABLE public.dropbox_images_index ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view dropbox index"
    ON public.dropbox_images_index
    FOR SELECT
    TO authenticated
    USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can insert dropbox index entries"
    ON public.dropbox_images_index
    FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM user_profiles
            WHERE user_profiles.id = auth.uid()
              AND user_profiles.role = 'admin'
        )
    );

CREATE POLICY "Admins can update dropbox index entries"
    ON public.dropbox_images_index
    FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM user_profiles
            WHERE user_profiles.id = auth.uid()
              AND user_profiles.role = 'admin'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM user_profiles
            WHERE user_profiles.id = auth.uid()
              AND user_profiles.role = 'admin'
        )
    );

CREATE POLICY "Admins can delete dropbox index entries"
    ON public.dropbox_images_index
    FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM user_profiles
            WHERE user_profiles.id = auth.uid()
              AND user_profiles.role = 'admin'
        )
    );

CREATE INDEX IF NOT EXISTS idx_dropbox_images_tags ON public.dropbox_images_index USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_dropbox_images_path ON public.dropbox_images_index (dropbox_path);
CREATE INDEX IF NOT EXISTS idx_dropbox_images_status ON public.dropbox_images_index (status);

CREATE OR REPLACE FUNCTION import_image_catalog(data jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  row_count integer;
  base_path text := '/Test_Enea Group Objects/Test Metadata/General/';
BEGIN
  INSERT INTO dropbox_images_index (dropbox_path, tags, status, last_scanned_at)
  SELECT
    base_path || replace(value->>'path', E'\\', '/') AS dropbox_path,
    ARRAY(SELECT lower(trim(t)) FROM jsonb_array_elements_text(value->'keywords') t) AS tags,
    'scanned' AS status,
    now() AS last_scanned_at
  FROM jsonb_array_elements(data)
  ON CONFLICT (dropbox_path) DO UPDATE
    SET tags = EXCLUDED.tags,
        status = EXCLUDED.status,
        last_scanned_at = EXCLUDED.last_scanned_at;
  GET DIAGNOSTICS row_count = ROW_COUNT;
  RETURN row_count;
END;
$$;
